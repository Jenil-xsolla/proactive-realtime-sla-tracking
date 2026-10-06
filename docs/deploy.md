# Deployment runbook

This app is deployed as **two Cloud Run services built from one source directory**, selected
at startup by `SERVICE_ROLE`. There is no path-based split: Cloud Run ingress is per service, so
the dashboard and the ingestion endpoints must be different services with different ingress
settings (design §1 "Deployment").

A missing or unrecognised `SERVICE_ROLE` stops the app at startup (`src/instrumentation.ts`,
`src/service-role.ts`) and every request also fails closed at the proxy layer
(`src/proxy.ts`) — so a misconfigured service refuses to serve anything rather than
silently exposing the wrong routes.

## Deployment path

Production runs in the Neuronet GCP project `xsolla-n8n-prod` (region `us-west2`), which already
hosts the Cloud SQL instance. Nobody deploys by hand: everything ships through a PR to
[`xsolla/neuronet-automations`](https://github.com/xsolla/neuronet-automations).

| What | Where in `neuronet-automations` |
|---|---|
| App code (this repo, once) | `services/sla-app/` |
| `sla-dashboard` service | `registry.yaml` → `services.sla-dashboard`, `source: services/sla-app/` |
| `sla-ingestion` service | `registry.yaml` → `services.sla-ingestion`, `source: services/sla-app/` |
| Scheduled alert run | `jobs/sla-alert-run/` + `registry.yaml` → `jobs.sla-alert-run` with `schedule:` |

Once the PR is reviewed and merged, the repo's CI (`.github/workflows/on-merge-deploy.yml`,
`scripts/ci-deploy-service.sh`, `scripts/ci-deploy-job.sh`) builds the images with Cloud Build
and runs `gcloud run deploy` / `gcloud run jobs deploy` as its own deployer service account.
You need no deploy permissions yourself. Deploy results are posted to `#neuronet-monitoring`.

**`registry.yaml` is the source of truth for service shape.** Ingress, scaling, CPU throttling,
VPC egress, env vars, secrets and invokers are all read from it on every deploy, so a manual
`gcloud run services update` is reverted by the next merge. Change the registry entry instead.
Plain env vars go under `env:` — **not** `env_vars:`, which the deployer silently ignores
(`docs/registry-env-vars-trap.md` in that repo).

### Prerequisite: runtime service account

Neuronet services run as a per-user runtime service account,
`neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com` (owner label `j-patel`). It must exist
before the first deploy — CI's preflight fails with an `actAs` error otherwise. Neuronet
onboarding creates it. Both services and the alert job run as this one account.

## Build

Both registry entries point `source:` at the same directory, `services/sla-app/`, which holds
this repo's code including its `Dockerfile` (multi-stage: `pnpm install --frozen-lockfile`,
`pnpm build` against `next.config.ts`'s `output: "standalone"`, then a minimal runtime stage that
runs `node server.js` as a non-root user on port 8080). CI builds one image per entry
(`us-docker.pkg.dev/xsolla-n8n-prod/neuronet/<service>:latest`) from that one directory, so the
two services always run identical code. Do not split the code into per-service directories —
nothing would then keep them identical.

The runtime image does not include devDependencies (in particular `tsx`, which
`pnpm db:migrate` needs — see **Database** below), so migrations run from a full checkout,
never from the built image.

## Service: `sla-dashboard`

- **Ingress:** `internal`. Requires authentication (`allow_unauthenticated: false`); the only
  invoker is the runtime service account, which `sla-ingestion` and the alert job both use.
- **Environment:**
  - `SERVICE_ROLE=dashboard` — plain env var, not a secret
  - `VIEWER_ROLE` — `business`, `technical`, or `system` (`src/feed/viewer.ts`); plain env var,
    not a secret — it's a stand-in for real session/SSO handling (main spec AD-5)
  - `DATABASE_URL` — connects as `sla_tracking_app_user` (SELECT on `sla_outages`, `sla_pir_reviews`,
    `sla_outage_corrections`; SELECT/INSERT/UPDATE on `sla_alert_state` — main spec §5.1)
  - `INTERNAL_SHARED_SECRET` — checked on `/api/internal/alerts/run` against the
    `x-internal-secret` header
  - `SLACK_BOT_TOKEN`
  - `SLACK_CHANNEL_LEGAL`
  - `SLACK_CHANNEL_ENGINEER`

```yaml
services:
  sla-dashboard:
    description: "SLA dashboard and alert evaluation (SERVICE_ROLE=dashboard). Internal ingress; invoked by sla-ingestion and the sla-alert-run job."
    type: service
    region: us-west2
    owner: j-patel
    service_account: neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com
    source: services/sla-app/
    port: 8080
    ingress: internal
    allow_unauthenticated: false
    iam_invokers:
      - serviceAccount:neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com
    env:
      SERVICE_ROLE: dashboard
      VIEWER_ROLE: <business|technical|system>
    secrets:
      - neuronet_user_j_patel_sla_database_url
      - neuronet_user_j_patel_sla_internal_shared_secret
      - neuronet_user_j_patel_sla_slack_bot_token
      - neuronet_user_j_patel_sla_slack_channel_legal
      - neuronet_user_j_patel_sla_slack_channel_engineer
    secrets_env:
      DATABASE_URL: neuronet_user_j_patel_sla_database_url
      INTERNAL_SHARED_SECRET: neuronet_user_j_patel_sla_internal_shared_secret
      SLACK_BOT_TOKEN: neuronet_user_j_patel_sla_slack_bot_token
      SLACK_CHANNEL_LEGAL: neuronet_user_j_patel_sla_slack_channel_legal
      SLACK_CHANNEL_ENGINEER: neuronet_user_j_patel_sla_slack_channel_engineer
    active: true
```

## Service: `sla-ingestion`

- **Ingress:** `all`, `allow_unauthenticated: true`. It has to be reachable by Jira Automation
  and Slack, neither of which can present a Cloud Run identity token — each route checks its own
  shared secret or signature instead (`JIRA_WEBHOOK_SECRET` on `/api/ingest/pir-approved`,
  Slack's request signature on `/api/slack/interactions`).
- **Environment:**
  - `SERVICE_ROLE=ingestion`
  - `INGESTION_DATABASE_URL` — connects as `sla_tracking_ingestion_writer` (SELECT/INSERT/UPDATE/DELETE on
    `sla_outages`; SELECT/INSERT/UPDATE on `sla_pir_reviews`; SELECT/INSERT on
    `sla_outage_corrections` — main spec §5.1)
  - `JIRA_BASE_URL`
  - `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
  - `JIRA_WEBHOOK_SECRET`
  - `SLACK_BOT_TOKEN`
  - `SLACK_SIGNING_SECRET`
  - `SLACK_CHANNEL_INGESTION` — `C0BUT8U637Y`
  - `DASHBOARD_INTERNAL_URL` — `sla-dashboard`'s URL; also used as the OIDC audience when
    fetching an identity token from the metadata server (`src/ingestion/notify/trigger-alerts.ts`)
  - `INTERNAL_SHARED_SECRET` — same value as on `sla-dashboard`; sent as `x-internal-secret`
    alongside the identity token
- **Minimum instances: 1, CPU always allocated** (`min_instances: 1`,
  `no_cpu_throttling: true`). Not optional. Two things depend on it (design §3):
  1. Slack requires a response to `/api/slack/interactions` within 3 seconds, including opening
     the correction modal. A cold start could blow that window.
  2. After responding, the route keeps running inside `after()` to call `chat.update` and trigger
     the alert run. Cloud Run throttles CPU after the response is sent unless CPU is always
     allocated, which would silently stall that follow-up work.
- **Direct VPC egress, all traffic:** required so it can reach `sla-dashboard` (internal ingress)
  to POST `/api/internal/alerts/run` after every capture and correction. `vpc_network` and
  `vpc_subnet` must both be set, and `vpc_egress` must be `all-traffic`: with
  `private-ranges-only`, calls to the dashboard's `*.run.app` URL leave over the public path and
  internal ingress rejects them. Outbound calls to Jira and Slack then leave through the
  project's Cloud NAT.

```yaml
services:
  sla-ingestion:
    description: "SLA ingestion: Jira PIR-approved webhook and Slack interactions (SERVICE_ROLE=ingestion). Public ingress; each route checks its own secret or signature. Always-on CPU for Slack's 3s window and after() work."
    type: service
    region: us-west2
    owner: j-patel
    service_account: neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com
    source: services/sla-app/
    port: 8080
    ingress: all
    allow_unauthenticated: true
    min_instances: 1
    no_cpu_throttling: true
    vpc_network: xsolla-n8n-prod-network
    vpc_subnet: cloudrun-jobs-egress-us-west2
    vpc_egress: all-traffic
    env:
      SERVICE_ROLE: ingestion
      SLACK_CHANNEL_INGESTION: C0BUT8U637Y
      DASHBOARD_INTERNAL_URL: <sla-dashboard-url>
    secrets:
      - neuronet_user_j_patel_sla_ingestion_database_url
      - neuronet_user_j_patel_sla_jira_base_url
      - neuronet_user_j_patel_sla_jira_email
      - neuronet_user_j_patel_sla_jira_api_token
      - neuronet_user_j_patel_sla_jira_webhook_secret
      - neuronet_user_j_patel_sla_slack_bot_token
      - neuronet_user_j_patel_sla_slack_signing_secret
      - neuronet_user_j_patel_sla_internal_shared_secret
    secrets_env:
      INGESTION_DATABASE_URL: neuronet_user_j_patel_sla_ingestion_database_url
      JIRA_BASE_URL: neuronet_user_j_patel_sla_jira_base_url
      JIRA_EMAIL: neuronet_user_j_patel_sla_jira_email
      JIRA_API_TOKEN: neuronet_user_j_patel_sla_jira_api_token
      JIRA_WEBHOOK_SECRET: neuronet_user_j_patel_sla_jira_webhook_secret
      SLACK_BOT_TOKEN: neuronet_user_j_patel_sla_slack_bot_token
      SLACK_SIGNING_SECRET: neuronet_user_j_patel_sla_slack_signing_secret
      INTERNAL_SHARED_SECRET: neuronet_user_j_patel_sla_internal_shared_secret
    active: true
```

`cloudrun-jobs-egress-us-west2` is the project's dedicated Cloud Run egress subnet; the older
`xsolla-n8n-prod-us-subnetwork` ran out of addresses (`docs/cloud-run-egress-subnet.md` in that
repo). `DASHBOARD_INTERNAL_URL` is only known after `sla-dashboard` first deploys, so the first
PR can ship the dashboard alone, or ship both and follow up with the URL.

## Secrets

Keep every credential and shared secret above in Secret Manager in `xsolla-n8n-prod`, following
the `neuronet_user_<slug>_<name>` naming used by the other per-user services. List each one under
`secrets:` and map it under `secrets_env:`; the deployer passes them as `--set-secrets`. The
deployer service account needs `secretAccessor` on each new secret. `SERVICE_ROLE`, `VIEWER_ROLE`,
`SLACK_CHANNEL_INGESTION` and `DASHBOARD_INTERNAL_URL` are not secrets and go under `env:`. The
secret names above are proposals; use whatever names onboarding creates.

## Database

1. **Responsibilities:** Infra/DBA provisions the Cloud SQL instance and database, an **owner**
   login that owns the database (used only for running migrations), and the `sla_tracking_app_user` and
   `sla_tracking_ingestion_writer` logins with no table privileges — the migrations grant those.
   `src/data/migrations/0004_service_grants.sql` grants to both roles and **fails if they don't
   exist yet**, so Infra must create all three logins before migrations run — this ordering is
   not optional. Infra puts all three connection strings in Secret Manager, and grants the app
   owner `roles/cloudsql.client` on the instance plus access to the owner secret. **The app
   owner — the operator — runs the migrations from their own checkout**; the DBA needs no
   repository access.

2. **Run the migrations** through the Cloud SQL Auth Proxy, since the instance is on a private
   IP and reaching it needs `roles/cloudsql.client`:

   ```sh
   cloud-sql-proxy xsolla-n8n-prod:us-west2:<INSTANCE> --port 5432
   ```

   Then, against `src/data/migrations`, with the connection as the schema owner role (not
   `sla_tracking_app_user` or `sla_tracking_ingestion_writer` — they only receive grants, they don't own the schema).
   `drizzle-kit migrate` has no `--url` flag and `drizzle.config.ts` has no `dbCredentials`
   hardcoded, so use `scripts/migrate.ts` (`pnpm db:migrate`) instead: it opens a `pg` `Pool` from
   `MIGRATION_DATABASE_URL` and runs Drizzle's `node-postgres` migrator against
   `src/data/migrations` directly.

   ```sh
   MIGRATION_DATABASE_URL="postgres://<owner>:<password>@localhost:5432/<db>" pnpm db:migrate
   ```

   - `MIGRATION_DATABASE_URL` — the schema-owner connection string, pointed at the proxy's
     `localhost:5432`, used only for this one-off migration step. It is not part of either Cloud
     Run service's runtime environment and is separate from `DATABASE_URL` (`sla_tracking_app_user`) and
     `INGESTION_DATABASE_URL` (`sla_tracking_ingestion_writer`) above. Keep it in Secret Manager or an
     operator's local secret store, not as a service env var.
   - The owner login must own the database, or have `CREATE` on it, because Drizzle creates a
     `drizzle` schema for its `__drizzle_migrations` tracking table.

3. **When:** once before the first deploy, and again before deploying any release that adds a
   file under `src/data/migrations`. Re-running is safe — Drizzle records applied migrations in
   `drizzle.__drizzle_migrations` and applies only the new files.

4. **Verify on Cloud SQL (Postgres 15+)** that `GRANT USAGE ON SCHEMA public` took effect for
   both `sla_tracking_app_user` and `sla_tracking_ingestion_writer`. Cloud SQL Postgres 15+ revokes the default
   CREATE-and-USAGE-to-PUBLIC grant on the `public` schema, so a role without explicit `USAGE`
   cannot reach the tables inside it even after the table-level grants. The test suite only
   verified the grants migration against PGlite, which does not enforce this — it has not been
   verified against real Cloud SQL. Check with:

   ```sql
   SELECT has_schema_privilege('sla_tracking_app_user', 'public', 'USAGE');
   SELECT has_schema_privilege('sla_tracking_ingestion_writer', 'public', 'USAGE');
   ```

   Both must return `t`.

## Scheduled alert run: `jobs/sla-alert-run`

The twice-daily alert run is a Neuronet **job**, not a hand-made Cloud Scheduler job. When a
`jobs:` entry has a `schedule:` field, `scripts/ci-deploy-job.sh` creates or updates the Cloud
Scheduler trigger itself, grants the runtime account `roles/run.invoker` on the job, and adds a
"Job Failed" alert policy. Each run executes the job's container once.

The job holds **no SLA logic**. It only calls the dashboard's alert-run endpoint, the same one
`sla-ingestion` calls, so `evaluate()` keeps one owner:

- **Schedule:** `0 1,13 * * *`, timezone `UTC` (main spec §10.6 / design §2)
- **Target:** `POST $DASHBOARD_INTERNAL_URL/api/internal/alerts/run`, body `{}`
- **Auth:** an identity token from the metadata server with audience `DASHBOARD_INTERNAL_URL`,
  plus `x-internal-secret: $INTERNAL_SHARED_SECRET`
- **Exit code:** non-zero on any non-2xx response, so the failed-job alert fires
- **Network:** jobs get Direct VPC egress by default, but with `private-ranges-only`; set
  `vpc_egress: all-traffic` so the call reaches the internal-ingress dashboard

`jobs/sla-alert-run/main.py`:

```python
import os
import sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import id_token

url = os.environ["DASHBOARD_INTERNAL_URL"]
token = id_token.fetch_id_token(Request(), url)
resp = requests.post(
    f"{url}/api/internal/alerts/run",
    json={},
    headers={
        "Authorization": f"Bearer {token}",
        "x-internal-secret": os.environ["INTERNAL_SHARED_SECRET"],
    },
    timeout=120,
)
print(resp.status_code, resp.text[:2000])
sys.exit(0 if resp.ok else 1)
```

`jobs/sla-alert-run/requirements.txt` holds `google-auth` and `requests`; the `Dockerfile` is the
standard `jobs/_template/Dockerfile`. Leave `write_access` out of the entry — this job does not
touch Neo4j.

```yaml
jobs:
  sla-alert-run:
    description: "Calls sla-dashboard's /api/internal/alerts/run at 01:00 and 13:00 UTC. Holds no SLA logic."
    source: jobs/sla-alert-run/
    schedule: 0 1,13 * * *
    timezone: UTC
    owner: j-patel
    service_account: neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com
    vpc_egress: all-traffic
    env:
      DASHBOARD_INTERNAL_URL: <sla-dashboard-url>
    secrets:
      - neuronet_user_j_patel_sla_internal_shared_secret
    secrets_env:
      INTERNAL_SHARED_SECRET: neuronet_user_j_patel_sla_internal_shared_secret
    active: true
```

## Slack app configuration

- **Scopes:** `chat:write` (covers `chat.postMessage` for the capture message and
  `chat.update` for editing it after a correction — `src/ingestion/notify`). `views.open`
  (opening the correction modal) does not need a separate OAuth scope beyond a valid bot token,
  but Interactivity must be turned on. Confirm in the Slack app's OAuth screen that no additional
  scope is flagged as missing before cutover.
- **Interactivity Request URL:** `<sla-ingestion-url>/api/slack/interactions`
- **Invite the bot** to `C0BUT8U637Y` (the ingestion channel) and to each channel configured as
  `SLACK_CHANNEL_LEGAL` / `SLACK_CHANNEL_ENGINEER`.

## Jira Automation

On PIR approval, configure a "Send web request" action:

- **Method:** POST
- **URL:** `<sla-ingestion-url>/api/ingest/pir-approved`
- **Headers:** `Jira-Webhook-Token: <JIRA_WEBHOOK_SECRET>`
- **Body:**

  ```json
  { "issueKey": "{{issue.key}}" }
  ```

## Local development

Set `SERVICE_ROLE=dashboard` or `SERVICE_ROLE=ingestion` in `.env` before running `pnpm dev` —
`src/instrumentation.ts` reads it and the app refuses to run without a valid value. `pnpm dev`
does not prepare eagerly, so `register()` only runs (and can only exit the process) on the first
request, not at the moment `next dev` starts.

## Cutover checklist

Adapted from `specs/plans/2026-09-28-ingestion-in-app-plan.md` ("Manual cutover checklist") for
the Neuronet deployment path:

1. Neuronet onboarding creates the runtime service account
   `neuronet-j-patel@xsolla-n8n-prod.iam.gserviceaccount.com` and the secrets above.
2. Infra provisions the owner login, `sla_tracking_app_user` and `sla_tracking_ingestion_writer` on the Cloud SQL instance
   in `xsolla-n8n-prod`; the app owner runs `pnpm db:migrate` through the Cloud SQL Auth Proxy
   (see **Database**).
3. Import the historical spreadsheet with `source = 'backfill'`. This is a manual import — no
   script was planned for it.
4. Open the PR to `xsolla/neuronet-automations` with `services/sla-app/`, the two `services:`
   entries, and `jobs/sla-alert-run/` with its `jobs:` entry. After review and merge, CI
   deploys all three. Fill in `DASHBOARD_INTERNAL_URL` once `sla-dashboard` has a URL.
5. Set the Slack app's Interactivity Request URL to `<sla-ingestion-url>/api/slack/interactions`,
   and invite the bot to `C0BUT8U637Y`.
6. Point the Jira Automation webhook at `/api/ingest/pir-approved` with body
   `{ "issueKey": "{{issue.key}}" }` and the `Jira-Webhook-Token` header.
7. Run `sla-alert-run` once (`gcloud run jobs execute sla-alert-run --region us-west2
   --project xsolla-n8n-prod`, which needs `run.jobs.run` on the job, or wait for the next
   01:00/13:00 UTC run) and confirm the execution exits 0.
8. **Capture and correct a test PIR end to end.** This step must explicitly verify:
   - (a) the merchants field's real REST ADF shape parses the same way the fixtures assume —
     `tests/fixtures/jira/README.md` notes that `customfield_13920`'s ADF was rebuilt by hand
     because a raw payload wasn't available, and flags it for verification against a real
     payload at cutover;
   - (b) the correction modal's datetime picker round-trips correctly in the viewer's Slack
     timezone and stores the right UTC instant;
   - (c) the capture message renders in `C0BUT8U637Y` and its Correct button opens the
     correction modal within Slack's 3-second window;
   - (d) the alert run fires once after the capture and again after the correction.

   Do not consider ingestion live until all four checks pass.

## Open question

**OQ-4 (main spec §14) is still open:** the Cloud SQL connection method from Cloud Run (Direct
VPC egress vs. the Cloud SQL connector) for `sla-dashboard`'s and `sla-ingestion`'s database
connections, and how `sla-dashboard` sits behind corporate SSO, are not yet decided. The
registry supports both connection methods (`cloudsql_instances`, or `vpc_network`/`vpc_subnet`),
but the entries above set neither for the database, and `allow_unauthenticated: false` on
`sla-dashboard` is IAM-level only — it is not a substitute for SSO. Resolve OQ-4 before relying
on this runbook for a production cutover.
