# LHC Connector — commercetools Connect *(Sessions 8 & 9)*

Three Connect applications for the Lifestyle Home Corp course: the cart rules Session 7 ran behind a
tunnel, the payment-success consumer Session 7 had to poll for, and a nightly job nobody triggers.

| Folder | Type | What it is | Session |
|---|---|---|---|
| [`cart-rules-service/`](cart-rules-service) | `service` | An HTTP endpoint an **API Extension** calls before a cart is saved | 8.2 |
| [`order-events/`](order-events) | `event` | A handler fed by a **Subscription** whose queue Connect provisions | 8.3 / 8.4 |
| [`price-feed-job/`](price-feed-job) | `job` | A **cron** handler — no HTTP surface, no caller | 8.5 |

> **Published at** https://github.com/commercetools/sphere-b2c-connector-2026 — `solution` branch.
> Verified before publishing: all three apps `tsc --noEmit` clean, `npm run build` produces `dist/`,
> 8/8 handler tests pass, and the running service answers a real `ExtensionInput` (400 with our
> message for 11 units; 200 + `setCustomField` for a €499 line). **No deployment has been run yet.**

## Why this is a separate repository

Connect deploys a **GitHub repository at a git tag**, and **`connect.yaml` must be at the repository
root**. A connector therefore cannot live in a subfolder of the course monorepo. It is authored in the
build repo at `courses/b2c-dev/code/connector/` and synced here by
[`sync-connector.sh`](../participant-sync/README.md), the same way the participant repo is.

`main` = starter (stubs) · `solution` = complete. **Tags are cut on `solution` only**, because the tag
is what Connect actually deploys.

## Run it locally (Session 8)

```bash
npm i -g @commercetools/connect-cli      # once
cp cart-rules-service/.env.example cart-rules-service/.env   # and the same for the other two
commercetools connect validate                               # connect.yaml, before Connect judges it
commercetools connect application start cart-rules-service
commercetools connect application start order-events
commercetools connect application test
```

The BFF must be running (`code/dev-all.sh`) — `order-events` calls its Session 6 order-state endpoint.

### Replaying an event locally

There is **no Subscription on a laptop**. The event application is an HTTP endpoint, so you deliver the
same base64 Pub/Sub envelope Connect will deliver:

```bash
MSG='{"id":"m-1","type":"OrderPaymentStateChanged","paymentState":"Paid",
      "sequenceNumber":2,"resource":{"typeId":"order","id":"<an order id>"}}'
curl -s localhost:8081/order-events -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$(printf '%s' "$MSG" | base64)\"}}"
```

Send it **twice**: one transition, not two. That is 8.3 and 8.4 proven — against the real payload
shape, on a laptop. The *genuine* push, where nobody runs a curl, needs a deployment: Session 9.3.

## Deploy it (Session 9 — trainer)

Slow and failable steps happen **before** the session; only the deploy and the teardown are live.

| # | Step | Note |
|---|---|---|
| 1 | Tag `solution` (e.g. `v1.0.0`) | the tag is what Connect deploys |
| 2 | Create the **ConnectorStaged** — repo URL + tag, `privateProjects: ["<region>:<projectKey>"]` | needs `manage_connectors` |
| 3 | **Request preview**, wait for `isPreviewable: true` | runs the validation pipeline; can fail |
| 4 | **Publish for private use** (`certification: false`) | certification is only for the public marketplace |
| 5 | **Deploy** (`sandbox`) | up to **15 minutes**; keep a warm one as a fallback |
| 6 | Warm the service ~2 min before the demo | see the cold-start note below |

**A trial project can only take `sandbox`** (`production` requires a non-trial Project). Sandbox
**scales to zero and needs ~15 s to boot**, while an API Extension's budget is **2 s** — so the first
cart write after an idle period fails. Do not hide this: it is the single best argument for a
`production` deployment the course can show.

**Each training gets a new org and project**, so per cohort either re-create the ConnectorStaged in the
new org (steps 2–4, scriptable) or add the cohort's project to `privateProjects` on an existing one —
verify which works for your org before relying on the second.

### What the deploy proves — query it, don't trust it

```bash
# postDeploy registered this at CONNECT_SERVICE_URL — a URL nobody typed
GET /extensions?where=key%3D%22lhc-cart-rules%22      # destination.url ends in .commercetools.app
# postDeploy created this against a topic Connect provisioned
GET /subscriptions?where=key%3D%22lhc-order-events%22 # destination.type = GoogleCloudPubSub
```

Then pay in the storefront and watch the order reach `order-picked` with nobody touching anything.

### Teardown — not housekeeping

`preUndeploy` deletes the Extension and the Subscription. **An orphaned Extension fails every cart
write on the project**, on a 2-second timeout, for whoever inherits it. After undeploying, run the two
queries above again and confirm they come back empty.

## Platform limits worth knowing

| Type | Limits that shape the code |
|---|---|
| `service` | Extension budget **2 s** (max 10 s) · app timeout 5 min · sandbox cold start **~15 s** |
| `event` | **10 s** to acknowledge · retry on anything outside `102·200·201·202·204` · unacked retained **7 days** · push backoff · at-least-once, **no ordering** |
| `job` | **30 min** timeout · overlapping runs are yours to prevent · failure is silent unless you log it |
