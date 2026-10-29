# Install `ecoliving-order-connectors` — participant guide *(breakout room)*

Your Session 7 handlers, moved to Connect:

| App | Type | Triggered by | Does |
|---|---|---|---|
| `cart-rules-service` | service | an **API Extension** on cart Create/Update | caps the quantity per line, flags white-glove lines (7.7) |
| `order-events` | event | a **Subscription** on order messages | moves a paid order to `order-picked` (7.4) |

**What you need:** Merchant Center access to the course organization with permission to manage connectors, and the
course project key. Nothing to build locally: Connect builds the tag itself.

**The repository must be readable by Connect.** It is private outside the training; the trainer makes it public for the
day (or grants the `connect-mu` machine user read access). A "repository not found" in step 2 means it is still private.

## 1 · Create the connector *(everyone, in your own name)*

A connector starts as a **ConnectorStaged**: a pointer to a GitHub repository **at a tag**. Creating one never touches
the project, so every participant can do this step.

Merchant Center → **Connect** → **Manage connectors** → **Create connector**, then:

| Field | Value |
|---|---|
| Name | `EcoLiving Order Connectors — <your name>` |
| Key | `<yourname>-ecoliving-order-connectors` *(keys are unique in the organization: use your own name)* |
| Repository URL | `https://github.com/commercetools/ecoliving-order-connectors.git` |
| Tag | `v1.0.5` |
| Private projects | the course project, e.g. `europe-west1.gcp:<project-key>` |
| Supported regions | `europe-west1.gcp` |

<details><summary>The same step through the Connect API</summary>

```http
POST https://connect.europe-west1.gcp.commercetools.com/connectors/drafts
Authorization: Bearer <token with manage_connectors>
Content-Type: application/json

{
  "key": "<yourname>-ecoliving-order-connectors",
  "name": "EcoLiving Order Connectors — <your name>",
  "description": "The cart-rules API Extension as a Service app and the order-events Subscription consumer as an Event app.",
  "creator": { "title": "Participant", "name": "<your name>", "email": "<your email>", "company": "<company>", "noOfDevelopers": 1 },
  "repository": { "url": "https://github.com/commercetools/ecoliving-order-connectors.git", "tag": "v1.0.5" },
  "privateProjects": ["europe-west1.gcp:<project-key>"],
  "supportedRegions": ["europe-west1.gcp"]
}
```
</details>

## 2 · Request the preview and wait for the validation

Open your connector → **Request preview** (API: `updatePreviewable`). Connect clones the tag and runs its pipeline:
build, tests, dependency and code scan for every application. This takes **a few minutes**. Refresh until the
status is **previewable**. If it fails, the report names the application and the step; the connector in this repository
passes it, so a failure here is almost always a wrong URL or tag, or a repository Connect cannot read.

## 3 · Publish it for private use

**Publish** → certification **off** (API: `{ "action": "publish", "certification": false }`). Publishing makes it a
**Connector** your project can install. Certification is only for the public marketplace.

## 4 · Deploy it *(one person per room — read this first)*

> **One deployment of this connector per project.** Its `postDeploy` registers the Extension `lhc-cart-rules` (on **every cart write** in the project) and the Subscription `lhc-order-events` under a **fixed key**, so a
> second deployment on the same project overwrites the first one's registration, and undeploying either removes it for
> both. In the breakout room, **everyone does steps 1–3; one person (the driver) deploys**, with the others watching the
> screen. If each of you has your own project, everyone can deploy.

Merchant Center → **Connect** → **Manage connectors** → **Organization connectors** → your connector → **Install** →
choose the project, region `europe-west1.gcp`, deployment type **Sandbox**, then enter the values below.

You are **not** asked for API credentials: `connect.yaml` declares `inheritAs.apiClient.scopes`, and Connect generates an
API client with exactly those scopes (`manage_extensions`, `manage_subscriptions`, `manage_orders`, `view_states`, `manage_key_value_documents`, `view_types`). That is least privilege you can read in the repository.

### Values

| App | Key | Sample value | Note |
|---|---|---|---|
| cart-rules-service | `EXTENSION_SECRET` **(secured, required)** | output of `openssl rand -hex 32` | write-only; keep a copy |
| | `MAX_QUANTITY_PER_LINE` | `10` | fallback when `lhc-config/feature-flags` can't be read |
| | `WHITE_GLOVE_THRESHOLD_CENTS` | `40000` | EUR 400.00 |
| | `CONFIG_CACHE_SECONDS` | `60` | never `0`: the Extension budget is 2 s |
| | `LOG_LEVEL` | `info` | |
| order-events | `TARGET_STATE_KEY` | `order-picked` | the seeder (Session 6) creates the State machine |
| | `CONFIRM_ORDER_STATE` | `true` | |
| | `MAX_MESSAGE_AGE_HOURS` | `72` | |
| | `LOG_LEVEL` | `info` | |

**Before deploying:** every participant has run `DELETE /api/extensibility/extension` (the Session 7 tunnel
Extension). Two cart-rules Extensions would both fire, and a dead tunnel fails every cart write with
`504 Extension did not respond in time`. Messages must be enabled (the Session 6 seeder folder does it).
The `order-extras` Custom Type must exist (the Session 7 seeder folder creates it): cart-rules-service writes
`requiresWhiteGlove` to it, and its postDeploy **fails on purpose** when the Type is missing — otherwise every cart
over the white-glove threshold would fail with "The extension returned update actions that could not be executed".

## 5 · Verify it works

When the deployment is **Deployed** and both postDeploy steps are green:

1. Open `<cart-rules URL>/status` once to wake the sandbox (≈15 s; the Extension gets 2 s).
2. Storefront: add 11 of one product → **"Max 10 units per line"** (the 400 from the Extension). An item at or above
   EUR 400 gets the white-glove flag (`custom.fields.requiresWhiteGlove`).
3. Place an order and pay → within seconds the order moves to **order-picked** with nobody touching it (the
   confirmation page / Session 7.3 timeline shows it).
4. Platform-side proof: `GET /extensions?where=key%3D%22lhc-cart-rules%22` → `destination.url` ends in
   `.commercetools.app`; `GET /subscriptions?where=key%3D%22lhc-order-events%22` → a `GoogleCloudPubSub` destination.

## 6 · Tear down

Undeploy **at the end of the day** → `preUndeploy` removes both. Check the two queries again: both empty. **A sleeping or orphaned cart Extension makes every cart write in the project slow or failing.**

## If something fails

| Symptom | Cause | Fix |
|---|---|---|
| Preview stays not previewable, "repository not found" | private repo, or a typo in the URL | check the URL; ask the trainer to open the repo |
| "Connector script postDeploy failed to execute" | open **Expand** in the script log: the last line names it | most often a missing secured value, or messages not enabled |
| Deployed, but nothing happens | the sandbox is asleep, or another deployment owns the fixed key | wake `/status`; check there is only one deployment of this connector |
