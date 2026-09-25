# LHC Connector — commercetools Connect *(course Sessions 8 & 9)*

Three Connect applications for the Lifestyle Home Corp course: the cart rules Session 7 ran behind a
tunnel, the payment-success consumer Session 7 had to poll for, and a nightly job nobody triggers.

| Folder | Type | What it does | Session |
|---|---|---|---|
| [`cart-rules-service/`](cart-rules-service) | `service` | An HTTP endpoint an **API Extension** calls before a cart is saved | 8.2 |
| [`order-events/`](order-events) | `event` | A handler fed by a **Subscription** whose queue Connect provisions | 8.3 / 8.4 |
| [`price-feed-job/`](price-feed-job) | `job` | A **cron** bulk price import through the Import API | 8.5 |

**One branch, `main`.** There is no starter/solution split: participants do not implement the
connector. The trainer walks this code through, everyone runs it locally, and the trainer installs it
once into the shared project. **Cut a tag before creating the ConnectorStaged — Connect deploys tags,
not branches.**

## Why this is a separate repository

Connect deploys a **GitHub repository at a git tag**, and **`connect.yaml` must be at the repository
root** — so a connector cannot live in a subfolder of the course monorepo. It is authored in the build
repo at `courses/b2c-dev/code/connector/` and synced here by `sync-connector.sh`.

---

## Fail-open or fail-closed — what happens when a dependency is down

Stated per behaviour, because this is the decision a production review asks about first.

| Dependency is down | Behaviour | Why |
|---|---|---|
| The **feature-flag Custom Object** is unreadable | **Fail open** — the rules run on the connector's own configured defaults | A config read blipped; blocking every cart in the project over a threshold that changes twice a year is the larger harm |
| The **service app itself** is down or slow | **The caller's write fails** (`ExtensionBadResponse`) — not our choice, the platform's | An API Extension couples your availability to the operation. This is the cost of the mechanism and the reason 9.4 asks whether each rule is worth it |
| The **order cannot be read** by the event app | **Acknowledge and drop**, logged as an error | Permanent: redelivery for 7 days will not make a deleted order reappear |
| The **State machine refuses** a transition (4xx) | **Acknowledge and drop**, logged as an error | Permanent: the machine will refuse the redelivery identically |
| commercetools returns **409 / 429 / 5xx** to the event app | **Nack** — the platform redelivers | Transient. The handler is idempotent, so a second delivery is safe |
| The **Import API** rejects a row | That row is reported failed; the job **exits non-zero** | Partial failure is normal for bulk; the run must still be visibly red |
| Another **job run** is still going | Skip, exit **zero** | Not a failure. A red log should mean something is wrong, not that the schedule is tight |

**Idempotency is stateless everywhere.** No local dedup store, no processed-ids table. The cart rules
return a delta (nothing to do = no actions), the event handler reads the order's own state, and the
import upserts by key. A local store would be a second source of truth that can disagree with the first.

## Scopes

Declared as `inheritAs.apiClient.scopes`, so **Connect generates an API Client holding exactly these**
and injects the credentials at runtime. Nobody pastes a `manage_project` secret into the install form —
there is no field for one.

| Scope | Needed by | For |
|---|---|---|
| `manage_extensions` | cart-rules-service | registering and removing its own Extension |
| `manage_subscriptions` | order-events | registering and removing its own Subscription |
| `manage_orders` | order-events | reading an order and transitioning it |
| `view_states` | order-events | expanding the order's custom State |
| `view_products` | price-feed-job | resolving SKU → product/variant keys |
| `manage_products` | price-feed-job | the price import writes products |
| `manage_import_containers` | price-feed-job | submitting and polling import operations |
| `manage_key_value_documents` | all three | feature flags, the feed document, the run lock |

The generated client is **shared by all three applications**, so the declared list is their union. A
real least-privilege split would mean three connectors; the per-application comments in `connect.yaml`
record what each one actually needs.

## Configuration

Every key in `connect.yaml`. **Secured values are write-only** — entered once at install, never shown
again, changeable only by redeploying.

### `cart-rules-service`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `EXTENSION_SECRET` | **secured** | — | Shared secret the platform presents on every Extension call. Required: the endpoint is public |
| `MAX_QUANTITY_PER_LINE` | standard | `10` | Fallback when the feature-flag Custom Object is unreadable |
| `WHITE_GLOVE_THRESHOLD_CENTS` | standard | `40000` | Fallback, as above |
| `CONFIG_CACHE_SECONDS` | standard | `60` | Flag cache TTL. Must not be 0 — the Extension budget is 2 s |
| `LOG_LEVEL` | standard | `info` | `debug` · `info` · `warn` · `error` |

### `order-events`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `TARGET_STATE_KEY` | standard | `order-picked` | State an order moves to once payment succeeds |
| `CONFIRM_ORDER_STATE` | standard | `true` | Also set the built-in `orderState` to `Confirmed` |
| `MAX_MESSAGE_AGE_HOURS` | standard | `72` | Backlog guard — drop anything older |
| `LOG_LEVEL` | standard | `info` | |

### `price-feed-job`
| Key | Kind | Default | Purpose |
|---|---|---|---|
| `IMPORT_CONTAINER_KEY` | standard | `lhc-price-feed` | ImportContainer (`resourceType: price`) |
| `FEED_CONTAINER` / `FEED_KEY` | standard | `lhc-price-feed` / `pending` | Custom Object holding `{ rows: [...] }` and the lock |
| `LOCK_STALE_MINUTES` | standard | `45` | A lock older than this is assumed abandoned |
| `POLL_TIMEOUT_SECONDS` / `POLL_INTERVAL_SECONDS` | standard | `120` / `5` | Waiting for ImportOperations to settle |
| `CTP_IMPORT_URL` | standard | derived | Import API host; derived from `CTP_API_URL` when blank |
| `LOG_LEVEL` | standard | `info` | |

---

## Run it locally

```bash
npm i -g @commercetools/cli                      # the Connect CLI
cp cart-rules-service/.env.example cart-rules-service/.env   # and the same for the other two
commercetools connect validate                   # connect.yaml, before Connect judges it
cd cart-rules-service && npm install && npm test && npm start
```

Locally the `CTP_*` values come from `.env`; deployed, Connect injects them. The code cannot tell the
difference, which is the whole point of `.env.example` mirroring the manifest.

### Exercising the service by hand

```bash
curl -s localhost:8080/cart-rules -H 'content-type: application/json' \
  -H "Authorization: Bearer $EXTENSION_SECRET" \
  -d '{"action":"Update","resource":{"typeId":"cart","id":"c1","obj":{"id":"c1","version":1,
       "lineItems":[{"id":"l1","quantity":11,"variant":{"id":1,"sku":"CARM-023"},
       "price":{"id":"p","value":{"type":"centPrecision","currencyCode":"EUR","centAmount":49900,"fractionDigits":2}}}]}}}'
```
Eleven units → `400` with your own message. Drop it to `1` → `200` with a `setCustomField` action. Drop
the `Authorization` header → `401`.

### Replaying an event by hand

There is **no Subscription on a laptop**, so you deliver the same base64 envelope Connect will:

```bash
MSG='{"id":"m-1","type":"OrderPaymentStateChanged","paymentState":"Paid",
      "resource":{"typeId":"order","id":"<a real order id>"}}'
curl -s localhost:8080/order-events -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$(printf '%s' "$MSG" | base64)\"}}"
```
Send it **twice**: one transition, not two — the handler reads the order's state rather than keeping a
dedup store. The genuine push, where nobody runs a curl, needs a deployment (Session 9.3).

---

## Deploy it *(trainer, Session 9)*

Everything slow or failable happens **before** the session; only the deploy and the teardown are live.

| # | Step | Note |
|---|---|---|
| 1 | Tag `main` (e.g. `v1.0.0`) | the tag is what Connect deploys |
| 2 | Create the **ConnectorStaged** — repo URL + tag, `privateProjects: ["<region>:<projectKey>"]` | needs `manage_connectors` |
| 3 | **Request preview**, wait for `isPreviewable: true` | runs the validation pipeline; can fail |
| 4 | **Publish for private use** (`certification: false`) | certification is only for the public marketplace |
| 5 | **Deploy** (`sandbox`), supplying `EXTENSION_SECRET` | up to **15 minutes** |
| 6 | Warm the service ~2 min before the demo | see the cold start below |

**A trial project can only take `sandbox`** (`production` requires a non-trial Project). Sandbox
**scales to zero and needs ~15 s to boot**, while an API Extension's budget is **2 s** — so the first
cart write after an idle period fails. Do not hide this; it is the clearest argument for a `production`
deployment the course can make.

### Verify from the API, not from the UI

```bash
GET /extensions?where=key%3D%22lhc-cart-rules%22       # destination.url ends .commercetools.app, authentication present
GET /subscriptions?where=key%3D%22lhc-order-events%22  # destination.type = GoogleCloudPubSub
```

### Teardown

`preUndeploy` deletes both. **An orphaned Extension fails every cart write on the project**, on a
2-second timeout, for whoever inherits it. After undeploying, run the two queries above again and
confirm they come back empty.

---

## Runbook

### A message keeps failing (poison message)
1. Find it: filter the deployment logs for `"ack":false` and take the `messageId` / `resourceId`.
2. Decide whether it is *permanent* (the order is gone, the State machine refuses) or *transient*
   (commercetools was unavailable). The handler already classifies these — if a permanent case is being
   nacked, that is the bug to fix.
3. **It retries for up to 7 days.** To stop it sooner, make the handler acknowledge that case, redeploy,
   and let the redelivery drain.
4. Raising `MAX_MESSAGE_AGE_HOURS`' inverse — *lowering* it — sheds an accumulated backlog after an
   outage: anything older is acknowledged and logged instead of acted on.

### Replaying events
There is no replay button. Messages are gone once acknowledged. To re-drive an order, either repeat the
business action (re-transition it) or POST the envelope by hand to the deployed endpoint, exactly as in
local development.

### The job did not run
It has no HTTP surface, so the logs are the only evidence. Check for `Skipped: another run is in
progress` (a lock held by a previous run) and for `Taking over a stale lock`. A crashed run's lock
expires after `LOCK_STALE_MINUTES`.

### Cart writes are failing project-wide
Almost always the Extension: either the service is cold (~15 s boot on sandbox, against a 2 s budget)
or a deployment was removed without `preUndeploy` running. Check
`GET /extensions?where=key="lhc-cart-rules"` — if it points at a deployment that no longer exists,
delete it.

## Platform limits worth knowing

| Type | Limits that shaped this code |
|---|---|
| `service` | Extension budget **2 s** (10 s max) · app timeout 5 min · sandbox cold start **~15 s** · max 25 Extensions per project |
| `event` | **10 s** to acknowledge · retry on anything outside `102·200·201·202·204` · unacked retained **7 days** · push backoff · at-least-once, **no ordering**, **no condition** |
| `job` | **30 min** timeout · no concurrency guard (we lock) · failure is silent unless logged |
| Import API | **20 resources** per request · a 2xx is an acknowledgement, not a result |
