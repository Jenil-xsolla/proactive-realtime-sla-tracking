# Deployment runbook

This app is built as **one container image** and deployed **twice** as separate Cloud Run
services, selected at startup by `SERVICE_ROLE`. There is no path-based split: Cloud Run ingress
is per service, so the dashboard and the ingestion endpoints must be different services with
different ingress settings (design §1 "Deployment").

A missing or unrecognised `SERVICE_ROLE` stops the app at startup (`src/instrumentation.ts`,
`src/service-role.ts`) and every request also fails closed at the proxy layer
(`src/proxy.ts`) — so a misconfigured service refuses to serve anything rather than
silently exposing the wrong routes.

## Build

Build one image from this repo and push it to your registry (Artifact Registry). Deploy that
same image twice, below, with different `--service`, ingress and env var settings. Do not build
per-service images — the two services must run identical code.

```sh
gcloud builds submit --tag <REGION>-docker.pkg.dev/<PROJECT>/<REPO>/sla-app:<TAG>
```

## Service: `sla-dashboard`

- **Ingress:** internal only (`--ingress internal` or `internal-and-cloud-load-balancing` if it
  sits behind a load balancer — see the open question below).
- **Authentication:** requires authentication. Do **not** deploy with `--allow-unauthenticated`.
  Grant `roles/run.invoker` to whichever identities need to call it (see the ingestion service
  account grant below, and any human/SSO access path once OQ-4 is resolved).
- **Environment:**
  - `SERVICE_ROLE=dashboard` — plain env var, not a secret
  - `VIEWER_ROLE` — `business`, `technical`, or `system` (`src/feed/viewer.ts`); plain env var,
    not a secret — it's a stand-in for real session/SSO handling (main spec AD-5)
  - `DATABASE_URL` — connects as `app_user` (SELECT on `sla_outages`, `sla_pir_reviews`,
    `sla_outage_corrections`; SELECT/INSERT/UPDATE on `sla_alert_state` — main spec §5.1)
  - `INTERNAL_SHARED_SECRET` — checked on `/api/internal/alerts/run` against the
    `x-internal-secret` header
  - `SLACK_BOT_TOKEN`
  - `SLACK_CHANNEL_LEGAL`
  - `SLACK_CHANNEL_ENGINEER`

```sh
gcloud run deploy sla-dashboard \
  --image <REGION>-docker.pkg.dev/<PROJECT>/<REPO>/sla-app:<TAG> \
  --ingress internal \
  --no-allow-unauthenticated \
  --set-env-vars SERVICE_ROLE=dashboard,VIEWER_ROLE=<business|technical|system> \
  --set-secrets DATABASE_URL=<secret>:latest,INTERNAL_SHARED_SECRET=<secret>:latest,SLACK_BOT_TOKEN=<secret>:latest,SLACK_CHANNEL_LEGAL=<secret>:latest,SLACK_CHANNEL_ENGINEER=<secret>:latest
```

## Service: `sla-ingestion`

- **Ingress:** public (`--ingress all`, `--allow-unauthenticated`). It has to be reachable by
  Jira Automation and Slack, neither of which can present a Cloud Run identity token — each
  route checks its own shared secret or signature instead (`JIRA_WEBHOOK_SECRET` on
  `/api/ingest/pir-approved`, Slack's request signature on `/api/slack/interactions`).
- **Environment:**
  - `SERVICE_ROLE=ingestion`
  - `INGESTION_DATABASE_URL` — connects as `ingestion_writer` (SELECT/INSERT/UPDATE/DELETE on
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
- **Minimum instances: 1, CPU always allocated (instance-based billing).** Not optional. Two
  things depend on it (design §3):
  1. Slack requires a response to `/api/slack/interactions` within 3 seconds, including opening
     the correction modal. A cold start could blow that window.
  2. After responding, the route keeps running inside `after()` to call `chat.update` and trigger
     the alert run. Cloud Run throttles CPU for a request-billed instance once the response is
     sent, which would silently stall that follow-up work.
- **Direct VPC egress:** required so it can reach `sla-dashboard` (internal ingress) to POST
  `/api/internal/alerts/run` after every capture and correction. This needs the VPC network and
  subnet attached (`--network`/`--subnet` below), not just `--vpc-egress`.
- **IAM:** grant the `sla-ingestion` runtime service account `roles/run.invoker` on
  `sla-dashboard`.

```sh
gcloud run deploy sla-ingestion \
  --image <REGION>-docker.pkg.dev/<PROJECT>/<REPO>/sla-app:<TAG> \
  --ingress all \
  --allow-unauthenticated \
  --min-instances 1 \
  --no-cpu-throttling \
  --network=<VPC> \
  --subnet=<SUBNET> \
  --vpc-egress all-traffic \
  --set-env-vars SERVICE_ROLE=ingestion \
  --set-secrets INGESTION_DATABASE_URL=<secret>:latest,JIRA_BASE_URL=<secret>:latest,JIRA_EMAIL=<secret>:latest,JIRA_API_TOKEN=<secret>:latest,JIRA_WEBHOOK_SECRET=<secret>:latest,SLACK_BOT_TOKEN=<secret>:latest,SLACK_SIGNING_SECRET=<secret>:latest,SLACK_CHANNEL_INGESTION=<secret>:latest,DASHBOARD_INTERNAL_URL=<secret>:latest,INTERNAL_SHARED_SECRET=<secret>:latest

gcloud run services add-iam-policy-binding sla-dashboard \
  --member "serviceAccount:<sla-ingestion-runtime-sa>" \
  --role "roles/run.invoker"
```

`--network` and `--subnet` are the Direct VPC egress flags — without them, `--vpc-egress` has no
network to attach to and the deploy is rejected. `--no-cpu-throttling` is what makes CPU always
allocated (the flag that matters for D7); `--cpu-boost` is a separate, optional startup-latency
optimization and is not required for correctness here.

## Secrets

Keep every credential and shared secret above in Secret Manager, mounted into each service as
environment variables (`--set-secrets`, not `--set-env-vars`). `SERVICE_ROLE` and `VIEWER_ROLE`
are the exceptions — neither is a secret, and both are set as plain env vars.

## Database

1. **Infra creates the roles before migrations run:** `app_user` and `ingestion_writer` must
   already exist on the Cloud SQL instance. `src/data/migrations/0004_service_grants.sql` grants
   to both roles and **fails if they don't exist yet** — this ordering is not optional.
2. **Run the migrations** against `src/data/migrations` with the connection as the schema owner
   role (not `app_user` or `ingestion_writer` — they only receive grants, they don't own the
   schema). `drizzle-kit migrate` has no `--url` flag and `drizzle.config.ts` has no
   `dbCredentials` hardcoded, so use `scripts/migrate.ts` (`pnpm db:migrate`) instead: it opens a
   `pg` `Pool` from `MIGRATION_DATABASE_URL` and runs Drizzle's `node-postgres` migrator against
   `src/data/migrations` directly.

   ```sh
   MIGRATION_DATABASE_URL="<owner-role-connection-string>" pnpm db:migrate
   ```

   - `MIGRATION_DATABASE_URL` — the schema-owner connection string, used only for this one-off
     migration step. It is not part of either Cloud Run service's runtime environment and is
     separate from `DATABASE_URL` (`app_user`) and `INGESTION_DATABASE_URL` (`ingestion_writer`)
     above. Keep it in Secret Manager or an operator's local secret store, not as a service env var.

3. **Verify on Cloud SQL (Postgres 15+)** that `GRANT USAGE ON SCHEMA public` took effect for
   both `app_user` and `ingestion_writer`. Cloud SQL Postgres 15+ revokes the default
   CREATE-and-USAGE-to-PUBLIC grant on the `public` schema, so a role without explicit `USAGE`
   cannot reach the tables inside it even after the table-level grants. The test suite only
   verified the grants migration against PGlite, which does not enforce this — it has not been
   verified against real Cloud SQL. Check with:

   ```sql
   SELECT has_schema_privilege('app_user', 'public', 'USAGE');
   SELECT has_schema_privilege('ingestion_writer', 'public', 'USAGE');
   ```

   Both must return `t`.

## Cloud Scheduler

Create one job that calls the dashboard's alert-run endpoint on the schedule from the design
(§10.6 / design §2):

- **Schedule:** `0 1,13 * * *`
- **Timezone:** UTC
- **Target:** `POST <sla-dashboard-url>/api/internal/alerts/run`
- **Auth:** OIDC token, audience = the `sla-dashboard` URL
- **Headers:** `x-internal-secret: <INTERNAL_SHARED_SECRET>`
- **Body:** `{}`

```sh
gcloud scheduler jobs create http sla-alert-run \
  --schedule "0 1,13 * * *" \
  --time-zone UTC \
  --uri "<sla-dashboard-url>/api/internal/alerts/run" \
  --http-method POST \
  --oidc-service-account-email <scheduler-invoker-sa> \
  --oidc-token-audience "<sla-dashboard-url>" \
  --headers "x-internal-secret=<INTERNAL_SHARED_SECRET>,Content-Type=application/json" \
  --message-body "{}"
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
`src/instrumentation.ts` reads it at startup and the app refuses to start without a valid value.

## Cutover checklist

From `specs/plans/2026-09-28-ingestion-in-app-plan.md` ("Manual cutover checklist"):

1. Infra creates the `app_user` and `ingestion_writer` roles, then run migrations on the GCP
   database (see **Database** above).
2. Import the historical spreadsheet with `source = 'backfill'`. This is a manual import — no
   script was planned for it.
3. Deploy both services per this document.
4. Set the Slack app's Interactivity Request URL to `<sla-ingestion-url>/api/slack/interactions`,
   and invite the bot to `C0BUT8U637Y`.
5. Point the Jira Automation webhook at `/api/ingest/pir-approved` with body
   `{ "issueKey": "{{issue.key}}" }` and the `Jira-Webhook-Token` header.
6. Create the Cloud Scheduler job.
7. **Capture and correct a test PIR end to end.** This step must explicitly verify:
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
`gcloud run deploy` commands above omit Cloud SQL connection flags (`--add-cloudsql-instances` or
equivalent) and the `--no-allow-unauthenticated` on `sla-dashboard` is IAM-level only — it is not
a substitute for SSO. Resolve OQ-4 before relying on this runbook for a production cutover.
