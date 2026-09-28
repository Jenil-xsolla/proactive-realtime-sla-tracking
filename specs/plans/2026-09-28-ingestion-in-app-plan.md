# Ingestion in the app — Implementation Plan

> For Claude: use `@subagent-driven-development` to implement this plan task by task. Every task uses `@test-driven-development`: write the failing test first, watch it fail, then implement.

**Design:** `specs/2026-09-25-ingestion-in-app-design.md` (the "design"), with `specs/sla-dashboard-spec.md` (the "main spec") for the shared registry, schema and alert route.
**Written:** 2026-09-28. No code has been written against this plan yet.

## Goal

Replace the n8n "Real-Time SLA Tracking" workflow with an ingestion module inside the app. It captures approved PIRs from a Jira Automation webhook and writes `sla_outages` immediately. Each capture is posted to Slack with a Correct button that works at any time. The same image is deployed as two Cloud Run services, gated by `SERVICE_ROLE`.

## Architecture overview

```
Jira Automation ──POST {issueKey}──▶ sla-ingestion /api/ingest/pir-approved
                                        │ 1 record receipt (sla_pir_reviews)
                                        │ 2 fetch PIR + linked incident (Jira REST)
                                        │ 3 extract → map ARIs → resolve merchants (registry)
                                        │ 4 write rows (writer.ts, one tx)
                                        │ 5 post capture message (Slack)
                                        └ 6 trigger alert run ──ID token + secret──▶ sla-dashboard /api/internal/alerts/run

Slack Correct button ──▶ sla-ingestion /api/slack/interactions
                           block_actions   → views.open (correction modal)
                           view_submission → correction tx → respond → after(): chat.update, trigger alerts
```

- `src/ingestion/{jira,resolution,notify}/`, `src/ingestion/writer.ts`, `src/ingestion/db.ts`. Only `src/ingestion/**` may import `writer.ts` or `db.ts`, and ESLint enforces it.
- `src/data/schema/` owns all four tables. The dashboard reads the ingestion tables through `src/data`.
- The engine, `evaluate()` and the feed composition stay unchanged, apart from carrying `source` and the ingestion health section.
- `src/proxy.ts` (Next 16's replacement for `middleware.ts`) is deny-by-default per role. `src/instrumentation.ts` throws at startup on a missing or unknown `SERVICE_ROLE`.

## Tech stack

Next.js 16.3 App Router, TypeScript strict, Drizzle ORM 0.45 + node-postgres, Vitest 5, ESLint 9, pnpm 10. New dev dependency: `@electric-sql/pglite` for in-process Postgres in tests. No new runtime dependency: Jira, Slack and the GCP metadata server are all called with `fetch`.

## Decisions taken while planning (2026-09-28)

These were settled with the user and go beyond or against the design as written. Task 0 writes them into the specs.

| # | Decision | Effect |
| --- | --- | --- |
| D1 | Outage minutes come from Jira field `customfield_31331` on the PIR. The webhook body stays `{ issueKey }`. | The design stands. n8n read `outageMinutes`/`issueUrl` from the body; we don't. `pir_url` is built from the Jira base URL and key. |
| D2 | A PIR with several services writes one row per (partner, service), identical apart from `affected_service`. | Unique key becomes `(pir_key, partner, affected_service)`, and `affected_service` becomes NOT NULL. The correction modal's service field becomes a multi-select, and a correction replaces the whole partner×service set. |
| D3 | DB-backed tests use PGlite in-process and run the real migrations. | `pnpm test` stays self-contained, and CI is unchanged. |
| D4 | `sla_pir_reviews` stores the extracted values (incident_started, outage_minutes, affected services, severity, pir_url). | The modal can prefill even when a PIR has zero rows. |
| D5 | "Already corrected" is decided per PIR (`version > 0`), not per row. | On redelivery, a corrected PIR's rows are never touched, even when a correction left it with zero rows. An uncorrected PIR's system-written set is replaced wholesale, and rows Jira no longer lists are deleted. |
| D6 | An ARI missing from the registry map is skipped and flagged as an unresolved value. It does not fail the PIR. | Unresolved values are typed: `{ kind: 'merchant' \| 'service_ari', raw }`. |
| D7 | `sla-ingestion` runs with CPU always allocated (instance-based billing) and minimum instances 1. | The Slack route commits, responds within 3s, then runs `chat.update` and the alert trigger inside `after()`. |
| D8 | Code scope includes the DB grants migration, the health panel UI and the deploy docs. The backfill import script is excluded; the spreadsheet layout is unknown. | Backfill import stays a manual cutover step. |

## Assumptions to confirm before starting (small, but CLAUDE.md says ask)

The implementer should get a yes/no on each before the task that depends on it. None of them changes task order.

| # | Assumption | First used in |
| --- | --- | --- |
| A1 | `SERVICE_ROLE` values are `dashboard` and `ingestion`. The dashboard role also 404s the two ingestion paths, because the proxy denies by default in both directions. | Task 19 |
| A2 | Env var names: `INGESTION_DATABASE_URL`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_WEBHOOK_SECRET` (header `Jira-Webhook-Token`, as n8n used), `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_INGESTION` (= `C0BUT8U637Y`), `DASHBOARD_INTERNAL_URL`. | Tasks 8, 15, 17, 18 |
| A3 | Missing or zero `customfield_31331` means no outage, so the PIR is `skipped` (n8n's rule). A non-numeric value means `failed`. | Task 7 |
| A4 | A missing incident link (type `11031`) or a missing incident `customfield_10068` means `failed`. n8n fell back to the PIR's `created` time, which is a different moment and would skew the timeline. | Task 7 |
| A5 | The merchants field (`customfield_13920`, ADF) is split on commas, semicolons and newlines. An all-digit token is a merchant ID. Any other token is matched by exact normalised name or alias, with no substring match. | Tasks 6, 7 |
| A6 | Severity is stored as the Jira option text (`customfield_11646.value`). The dashboard resolves it as it does today. A missing severity means `failed`. | Task 7 |
| A7 | `partner_id` gets the merchant ID token when the match was by ID. Otherwise it gets the registry's single `merchantIds[0]`. A partner with more than one merchant ID and a name-only match would store null. | Task 10 |
| A8 | Redelivery of `received` (an earlier attempt died mid-request) or `skipped` re-runs the PIR the same way as `failed`. A row lock (`SELECT … FOR UPDATE`) serialises concurrent deliveries. | Task 9 |
| A9 | On an uncorrected redelivery, the original capture message is edited in place, not re-posted. | Task 16 |

## Conflicts between the code and the spec (spec wins, noted for the user)

- `src/data/schema/outages.ts` calls `sla_outages` "read-only mirror of the n8n-owned table". It has `reviewedAt.defaultNow()` (the spec says null unless `human_corrected`) and no `source`/`reason`. Task 2 fixes it.
- `drizzle.config.ts` excludes `sla_outages` on purpose. Task 2 includes it.
- `src/app/api/internal/alerts/run/route.ts`'s doc comment says n8n calls the route. Task 22 fixes it.
- `src/feed/types.ts` has `OutageProvenance` "null until sla_outages gains a source column". Task 3 wires it up.
- Main spec §4 lists `.claude/rules/ingestion.md`, but `.claude/*` is now gitignored in the uncommitted `.gitignore` change. Task 22 creates the file locally only; it can't be committed. **The user needs to decide.**

## Prerequisites

- [ ] Commit the current uncommitted spec, README and `.gitignore` changes first. Task 0 edits the same spec files, and its commit should hold only this plan's changes.
- [ ] Create a branch: `git switch -c ingestion-in-app`. Do not work on `main`.
- [ ] Get Jira read credentials (email + API token) for Task 6.
- [ ] Get confirmation on A1–A9.

## Conventions every task follows

- Every route: `export const dynamic = "force-dynamic"`, `export const fetchCache = "force-no-store"`, `noStore()`, `Cache-Control: no-store` on every response, and `cache: "no-store"` on every outbound fetch.
- Outbound calls take an injectable `fetch` (the pattern in `src/alerts/slack.ts`). Time takes an injectable `now`, and nothing calls `new Date()` in logic that is under test.
- DB tests use `createTestDatabase()` from Task 1. Each test gets a fresh PGlite instance.
- Each task ends with `pnpm test && pnpm lint && pnpm typecheck` green, then one commit. The commands below list only the focused test; always run the full trio before committing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 0: Bring both specs in line with D1–D8

**Files:** `specs/2026-09-25-ingestion-in-app-design.md`, `specs/sla-dashboard-spec.md`
**Action:** Modify (docs only)

- Design §1 schema: change the unique key to `(pir_key, partner, affected_service)` and make `affected_service` `text not null`. Add the extracted-value columns and typed unresolved values to `sla_pir_reviews` (D4, D6).
- Design §2: step 3 reads minutes from `customfield_31331` (D1). Step 4 maps each ARI, skipping and flagging unknown ones (D6). Step 5 writes one row per partner×service (D2). Rewrite the redelivery paragraph per D5.
- Design §3: the modal's service field becomes a multi-select. Step 3 of handling a correction says "replace the partner×service set". The 3-second paragraph adds CPU always allocated (D7).
- Main spec §2 and §5.0: the idempotency key is `(pir_key, partner, affected_service)`.

**Test command:** `pnpm test`. **Expected:** unchanged, all passing.
**Commit:** `docs(specs): per-service rows, per-PIR correction state, stored extracted values`

---

## Task 1: PGlite test harness

**Files:** `package.json` (add devDependency `@electric-sql/pglite`), `tests/support/database.ts` (new), `tests/support/database.test.ts` (new)
**Action:** Create

- `createTestDatabase(): Promise<{ db, client, close }>`: opens an in-memory `PGlite` and creates the roles `app_user` and `ingestion_writer` (NOLOGIN) so the grants migration in Task 4 applies. It runs `migrate()` from `drizzle-orm/pglite/migrator` against `src/data/migrations`, and returns a Drizzle PGlite database typed with the same schema object as `src/data/db.ts`.
- Export the schema object from `src/data/db.ts` (`export const schema`) so that the test DB and the production DB share one definition.

**Tests (`tests/support/database.test.ts`):**
- "applies the existing migrations": `sla_alert_state` exists with column `partner_slug` and not `partner_id`.

**Test command:** `pnpm vitest run tests/support/database.test.ts`
**Expected:** `✓ applies the existing migrations`
**Commit:** `test: add in-process Postgres harness running real migrations`

---

## Task 2: `sla_outages` owned by the repo, with constraints

**Files:** `src/data/schema/outages.ts`, `drizzle.config.ts`, `src/data/migrations/0002_*.sql` (generated), `tests/data/outages-schema.test.ts` (new)
**Action:** Modify / generate

- Replace the doc comment, which says the repo owns the table now. Keep the "partner_id is a merchant id, not a foreign key" note, as §5.2 of the main spec asks.
- Columns follow design §1 as amended by Task 0. `affected_service` is not null. Add `reason`, `source` (not null). Drop the `reviewedAt` default.
- Unique `sla_outages_pir_key_partner_service_key` on `(pir_key, partner, affected_service)`.
- Checks (Drizzle `check()`):
  - `source in ('pipeline','backfill')`
  - `decision_type is null or decision_type in ('system_written','human_corrected')`
  - `(decision_type is null) = (source = 'backfill')`
  - `coalesce(decision_type = 'human_corrected', false) = (reviewed_by is not null)`. The `coalesce` is what makes this hold for backfill rows. Without it the comparison is NULL and the check passes vacuously.
  - `coalesce(decision_type = 'human_corrected', false) = (reviewed_at is not null)`
  - `outage_minutes > 0`
- `drizzle.config.ts`: `schema: "./src/data/schema/*.ts"`. Run `pnpm drizzle-kit generate --name sla_outages`. Read the generated SQL before committing: it must be a CREATE TABLE with the checks, and nothing else.

**Tests (`tests/data/outages-schema.test.ts`, PGlite):**
- accepts a backfill row with null `decision_type` and null `reviewed_by`
- rejects a backfill row with a `decision_type`
- rejects a pipeline row with null `decision_type`
- rejects `human_corrected` without `reviewed_by`, and without `reviewed_at`
- rejects `system_written` with a `reviewed_by`
- rejects `outage_minutes = 0`
- rejects a duplicate `(pir_key, partner, affected_service)`, and accepts the same PIR and partner with a second service

**Test command:** `pnpm vitest run tests/data/outages-schema.test.ts`
**Expected:** 8 passing. The existing `tests/data/outages.test.ts` still passes, because `OutageSourceRow` is hand-typed.
**Commit:** `feat(data): own sla_outages schema with provenance check constraints`

---

## Task 3: Carry `source` through to the technical view

**Files:** `src/data/outages.ts`, `src/feed/types.ts`, `src/feed/technical.ts`, `tests/data/outages.test.ts`, `tests/feed/business-payload.test.ts` (fixture only)
**Action:** Modify

- `OutageSourceRow` gains `source: string`, and `UsableOutage` gains `source: "pipeline" | "backfill" | null`, parsed once at the edge. An unknown value becomes null and is not dropped.
- `TechnicalOutage.source` is filled from it. Update the `OutageProvenance` comment.

**Tests:** "passes source through to usable rows" and "maps an unrecognised source to null without dropping the row". The existing business-payload test still asserts no PIR keys.

**Test command:** `pnpm vitest run tests/data tests/feed`
**Commit:** `feat(feed): show source provenance on technical outage rows`

---

## Task 4: `sla_pir_reviews` and `sla_outage_corrections`

**Files:** `src/data/schema/pir-reviews.ts` (new), `src/data/schema/outage-corrections.ts` (new), `src/data/db.ts` (schema object), `src/data/index.ts`, `src/data/migrations/0003_*.sql` (generated), `tests/data/ingestion-schema.test.ts` (new)
**Action:** Create / generate

`sla_pir_reviews`:
- `pir_key` text, primary key
- `status` text, not null, check in (`received`, `skipped`, `captured`, `failed`)
- `version` int, not null, default 0
- `unresolved_values` jsonb, not null, default `'[]'`, holding `{kind, raw}[]` (D6)
- extracted values (D4), all nullable because they are unknown until the fetch: `incident_started` timestamptz, `outage_minutes` numeric, `affected_services` jsonb (display names), `severity` text, `pir_url` text
- `slack_channel` text, `slack_ts` text, `slack_error` text, `error` text
- `received_at` timestamptz not null, `updated_at` timestamptz not null

`sla_outage_corrections`:
- `id` serial
- `pir_key` text, not null, references `sla_pir_reviews`
- `corrected_by` text not null, `corrected_at` timestamptz not null
- `before` jsonb not null, `after` jsonb not null
- `reason` text

**Tests:** rejects an unknown status; `version` defaults to 0; a correction referencing an unknown `pir_key` is rejected.

**Test command:** `pnpm vitest run tests/data/ingestion-schema.test.ts`
**Commit:** `feat(data): add PIR review log and correction history tables`

---

## Task 5: Database users and grants

**Files:** `src/data/migrations/0004_service_grants.sql` (hand-written via `drizzle-kit generate --custom --name service_grants`), `tests/data/grants.test.ts` (new)
**Action:** Create

Grants exactly as in main spec §5.1. Also grant `USAGE` on the serial sequences that each writer needs (`sla_outages_id_seq` for `ingestion_writer`, `sla_outage_corrections_id_seq` for `ingestion_writer`). The migration assumes the roles exist, and the runbook in Task 21 says infra creates them first.

**Tests (PGlite, `SET ROLE`):**
- `app_user` can SELECT all three ingestion tables but cannot INSERT into `sla_outages`
- `app_user` can write `sla_alert_state`
- `ingestion_writer` can DELETE from `sla_outages`
- `ingestion_writer` cannot touch `sla_alert_state`
- `ingestion_writer` cannot UPDATE or DELETE `sla_outage_corrections`

If PGlite does not honour `SET ROLE`, fall back to asserting the rows in `information_schema.role_table_grants`, and note it in the test.

**Test command:** `pnpm vitest run tests/data/grants.test.ts`
**Commit:** `feat(data): grant per-service database access`

---

## Task 6: ARI map in the registry

**Files:** `src/registry/services.ts`, `src/registry/types.ts`, `src/registry/resolve.ts`, `src/registry/index.ts`, `tests/registry/resolve.test.ts`
**Action:** Modify

- Service entries gain `aris: readonly string[]`, holding the 32 UUIDs from the n8n "ARI to ServiceName Mapping" node (workflow `ayGR5EibR4xQOf45`). Copy them exactly: the UUID for Payments is `271a0cee-45d2-11f0-81c7-122fa60ab53d`, and so on. Every current service has exactly one.
- `resolveServiceAri(ari: string): ResolveResult<ServiceId>` accepts a bare UUID or a full ARI (it takes the segment after the last `/`). It builds its lookup once and throws at module load on a UUID mapped to two services, the same way `buildLookup` does.

**Tests:** resolves a bare UUID; resolves a full `ari:cloud:…/uuid`; an unknown UUID is unresolved with `raw` equal to the UUID; every `SERVICES` entry has at least one ARI; a table-driven test on all 32 pairs from n8n.

**Test command:** `pnpm vitest run tests/registry/resolve.test.ts`
**Commit:** `feat(registry): move the ARI-to-service map from n8n into the registry`

---

## Task 7: Record Jira fixtures, then extract fields from them

**Step 7a — record (manual, no code):** with the Prerequisite credentials, fetch:
- 3 PIRs: one with a single service, one with several services, one with no outage
- their linked incidents

Use the n8n field lists: PIR `fields=summary,status,created,customfield_11646,customfield_31331,customfield_10399,customfield_13920,customfield_10250,issuelinks`, and incident `fields=customfield_10068,created`. Save them as `tests/fixtures/jira/<key>.pir.json` and `<key>.incident.json`, with people's names, emails and account IDs redacted.

**Stop and ask the user if `customfield_31331` does not hold the outage minutes as a number (D1).**

**Step 7b — extract:** `src/ingestion/jira/extract.ts`, `tests/ingestion/jira-extract.test.ts`

- `extractPir(pir: unknown, incident: unknown | null, baseUrl: string): ExtractResult`. Pure, and it validates shape without trusting it.
- `ExtractResult` =
  - `{ kind: "no_outage" }`
  - `{ kind: "invalid"; missing: string[] }`
  - `{ kind: "ok"; value: { pirKey, pirUrl, severity, outageMinutes, incidentStarted: Date, serviceAris: string[], merchantValues: string[] } }`
- `incidentKey(pir): string | null`: follows link type `11031`, outward then inward.
- ADF text is flattened as in n8n (paragraph → text nodes). Merchant tokens are split per A5.

**Tests:** one per fixture; missing severity → `invalid`; missing incident start → `invalid` (A4); zero/absent minutes → `no_outage` (A3); non-numeric minutes → `invalid`; merchants text `"506855, Scopely\nNiantic Inc"` → three tokens.

**Test command:** `pnpm vitest run tests/ingestion/jira-extract.test.ts`
**Commit:** `feat(ingestion): extract PIR fields from recorded Jira payloads`

---

## Task 8: Jira client

**Files:** `src/ingestion/jira/client.ts`, `tests/ingestion/jira-client.test.ts`
**Action:** Create

`fetchIssue({ key, fields, fetch?, env? }): Promise<{ ok: true; json } | { ok: false; error: string }>`: Basic auth from `JIRA_EMAIL:JIRA_API_TOKEN` against `JIRA_BASE_URL/rest/api/3/issue/{key}?fields=…`. It uses `cache: "no-store"` and a 10s timeout. The key is validated against `^[A-Z][A-Z0-9]+-\d+$` before any request.

**Tests:** builds the right URL and auth header; a 404 becomes `ok: false` with the status in the error; a timeout becomes `ok: false`; a malformed key makes no request; the error text never contains the token.

**Commit:** `feat(ingestion): Jira REST client`

---

## Task 9: Writer — receipt and status transitions

**Files:** `src/ingestion/db.ts`, `src/ingestion/writer.ts`, `tests/ingestion/writer-receipt.test.ts`
**Action:** Create

- `db.ts`: `getIngestionDatabase()` reads `INGESTION_DATABASE_URL` and mirrors `src/data/db.ts`.
- `recordReceipt(db, pirKey, now): Promise<{ kind: "new" | "retry" | "redelivery"; version: number }>`. In one transaction it locks the row with `FOR UPDATE`, then:
  - no row → insert `received` → `new`
  - `failed`, `skipped` or `received` → set `received`, clear `error` → `retry` (A8)
  - `captured` → leave the status → `redelivery`
- `markSkipped`, `markFailed(error)`, `saveSlackMessage(channel, ts)`, `saveSlackError(error)`. All set `updated_at`.

**Tests (PGlite):** new PIR inserts `received`; `failed` → `received`; `captured` returns `redelivery` and keeps `captured`; **receipt-first**: after `recordReceipt` and then `markFailed`, a `failed` row with the error text exists.

**Commit:** `feat(ingestion): record PIR receipt before any other work`

---

## Task 10: Partner and service resolution

**Files:** `src/ingestion/resolution/index.ts`, `tests/ingestion/resolution.test.ts`
**Action:** Create

- `resolveMerchantValues(values: string[]): { partners: ResolvedPartner[]; unresolved: UnresolvedValue[] }`: an all-digit token goes to `resolvePartner({ merchantId })`, and an unknown ID does **not** fall back to name. Any other token goes to `resolvePartner({ merchantId: null, name })`. Partners are deduplicated by registry ID, and the first merchant ID seen is kept.
- `resolveServiceAris(aris: string[]): { services; unresolved }` wraps Task 6.
- `buildCaptureRows(extracted, partners, services): CaptureRow[]`.

**Tests (design §4):** by merchant ID; by display name; by alias (`"Warner Bros. Games"`); unresolved name; unknown ID is unresolved even when a name would match; the same partner by ID and by name counts once; an unknown ARI becomes `{kind: "service_ari"}` (D6).

**Commit:** `feat(ingestion): resolve merchants and services by registry lookup`

---

## Task 11: Writer — capture

**Files:** `src/ingestion/writer.ts`, `tests/ingestion/writer-capture.test.ts`
**Action:** Modify

`captureRows(db, input: { pirKey, extracted, rows: CaptureRow[], unresolved: UnresolvedValue[] }, now): Promise<{ kind: "written"; rows } | { kind: "corrected_untouched" }>`, in one transaction:
1. Lock the review. If `version > 0` → save the extracted values and return `corrected_untouched` (D5).
2. Delete this PIR's rows whose `(partner, affected_service)` is not in `rows`.
3. Upsert `rows` on `(pir_key, partner, affected_service)` with `source = 'pipeline'`, `decision_type = 'system_written'`, and reviewer fields null.
4. Set the review to `captured` with the extracted values and `unresolved_values`.

`CaptureRow` = partner display name, `partner_id` (A7), service display name, and the shared `incident_started`, minutes, severity and `pir_url`. Rows are the cross product of resolved partners × resolved services, built by `buildCaptureRows()` in `src/ingestion/resolution/`.

**Tests (PGlite):**
- two partners × two services → four rows
- redelivery with changed minutes refreshes `system_written` rows
- redelivery that drops a partner deletes that partner's rows
- a PIR with `version > 0` is untouched, including one with zero rows
- zero resolved partners → zero rows, status `captured`, unresolved values stored

**Commit:** `feat(ingestion): write system rows per partner and service`

---

## Task 12: ESLint boundary for the writer and the ingestion DB client

**Files:** `eslint.config.mjs`, `tests/ingestion/boundaries.test.ts`
**Action:** Modify / create

- A `no-restricted-imports` block for `src/**` and `scripts/**`, with `ignores: ["src/ingestion/**"]`. It blocks `@/ingestion/writer`, `@/ingestion/db`, and relative paths ending in `ingestion/writer` or `ingestion/db`.
- `src/ingestion/index.ts` must not re-export either one.

**Tests:** use `ESLint` from `eslint` with `lintText(source, { filePath: "src/feed/x.ts" })` to assert an error for each import form, and none for `filePath: "src/ingestion/notify/x.ts"`. Also follow `tests/alerts/boundaries.test.ts`: `src/ingestion/index.ts` does not mention `writer` or `db`.

**Commit:** `build(lint): only ingestion may import its writer and database client`

---

## Task 13: Shared Slack Web API caller

**Files:** `src/slack/client.ts` (new), `src/alerts/slack.ts`, `tests/alerts/slack.test.ts`, `tests/slack/client.test.ts` (new)
**Action:** Refactor, then extend

- Move the attempt, 429 retry, `ok: true` classification and error explanation logic into `callSlack({ method, token, body, fetch?, sleep?, now? }): Promise<{ ok: true; data } | { ok: false; error }>`.
- `postSlackMessage` becomes a thin wrapper, and its tests pass unchanged. That is the refactor check.
- Add `postMessage` with blocks (it returns `ts`), `updateMessage` (`chat.update`) and `openView` (`views.open`, 2.5s timeout so the 3s window holds).
- Update `tests/alerts/boundaries.test.ts` if its URL assertion moves.

**Tests:** existing slack tests pass; `chat.update` with `ok: false` returns the error; `views.open` times out at 2.5s.

**Commit:** `refactor(slack): share one Web API caller between alerts and ingestion`

---

## Task 14: Slack signature verification

**Files:** `src/ingestion/notify/verify.ts`, `tests/ingestion/slack-verify.test.ts`
**Action:** Create

`verifySlackRequest({ rawBody, timestamp, signature, secret, now }): { ok: true } | { ok: false; reason }` checks HMAC-SHA256 of `v0:{ts}:{body}`, compared with `timingSafeEqual` after a length check. It rejects if `|now − ts| > 300s`, and rejects a missing header or secret.

**Tests (design §4):** valid; stale timestamp (301s); tampered body; wrong-length signature; missing secret.

**Commit:** `feat(ingestion): verify Slack request signatures`

---

## Task 15: Alert trigger client

**Files:** `src/ingestion/notify/trigger-alerts.ts`, `tests/ingestion/trigger-alerts.test.ts`
**Action:** Create

`triggerAlertRun({ fetch?, env? }): Promise<{ ok: boolean; error?: string }>`:
1. Get an ID token from `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience={DASHBOARD_INTERNAL_URL}` with `Metadata-Flavor: Google`.
2. POST `{DASHBOARD_INTERNAL_URL}/api/internal/alerts/run` with `Authorization: Bearer <token>` and `x-internal-secret`.

It never throws; the caller logs the result.

**Tests:** sends both headers; a metadata failure returns `ok: false` and does not call the dashboard; a 500 from the dashboard returns `ok: false`.

**Commit:** `feat(ingestion): trigger the alert run with a Cloud Run identity token`

---

## Task 16: Capture message builder

**Files:** `src/ingestion/notify/messages.ts`, `tests/ingestion/messages.test.ts`
**Action:** Create

- `captureMessage({ review, rows, lastCorrection? }): { text; blocks }`. The first line is `"{KEY} captured. It will appear on the dashboard."`, followed by the PIR key linked to `pir_url`. There is one line per row (partner, `partner_id`, UTC start, service, minutes, severity). Unresolved values appear in a section *above* the rows. The single button has `action_id: "correct"` and `value: pirKey`.
- `failureNotice`, `correctedAfterJiraChangeNote`, and the "last corrected by X at T" footer.

**Tests:** header text; unresolved section precedes rows; one Correct button; the footer appears only with a correction.

**Commit:** `feat(ingestion): capture message with Correct button`

---

## Task 17: `handlePirApproved` orchestration

**Files:** `src/ingestion/handle-pir.ts`, `src/ingestion/index.ts`, `tests/ingestion/handle-pir.test.ts`
**Action:** Create

`handlePirApproved(issueKey, deps: { db, jira, slack, triggerAlerts, now }): Promise<Outcome>` runs design §2 as amended: receipt, then fetch PIR, then `no_outage` → skipped. Next it fetches the incident, extracts, resolves, captures, and posts the message; a redelivery edits the original message instead (A9). A `corrected_untouched` result posts the Jira-changed note. Last it triggers alerts. Every error after receipt → `markFailed`, then post `failureNotice`. It never throws.

**Tests (PGlite + fakes, design §4):**
- happy path: rows, `captured`, message saved, trigger called
- no outage → `skipped` with no message
- Jira fetch fails → `failed` + notice
- DB write fails → `failed` + notice, **and no capture message**
- Slack `ok: false` → rows written, `slack_error` saved
- redelivery of an uncorrected PIR edits the message
- redelivery of a corrected PIR posts the note and leaves rows unchanged
- trigger failure is logged, not fatal

**Commit:** `feat(ingestion): capture approved PIRs end to end`

---

## Task 18: Route `POST /api/ingest/pir-approved`

**Files:** `src/app/api/ingest/pir-approved/route.ts`, `tests/ingestion/pir-route.test.ts`
**Action:** Create

The `Jira-Webhook-Token` header is checked against `JIRA_WEBHOOK_SECRET` with the timing-safe compare from the alerts route. Move that helper to `src/app/api/shared-secret.ts` and reuse it in both routes. Bad or missing secret → 401. A body that isn't `{ issueKey: string }` → 400. Otherwise → `handlePirApproved`, then **200 on every outcome** (design §2). Caching conventions apply.

**Tests:** 401 without the header; 400 on a bad body; 200 with the outcome for a failure path (fake deps via a module-level `setDepsForTest`, or by passing deps like `runAlerts` does); `cache-control: no-store`.

**Commit:** `feat(ingestion): Jira Automation webhook route`

---

## Task 19: Service role gating

**Files:** `src/service-role.ts`, `src/proxy.ts`, `src/instrumentation.ts`, `.env.example`, `tests/app/service-role.test.ts`
**Action:** Create

- `readServiceRole(env): "dashboard" | "ingestion"` throws on missing or unknown (A1).
- `isPathAllowed(role, pathname): boolean`. `ingestion` allows exactly `/api/ingest/pir-approved` and `/api/slack/interactions`. `dashboard` allows everything else, apart from those two, including `/_next/*` and `/favicon.ico`.
- `proxy.ts` returns 404 when the path is not allowed. Its matcher covers all paths.
- `instrumentation.ts` `register()` calls `readServiceRole(process.env)` so that a bad value stops startup.

**Tests (design §4):** ingestion 404s `/`, `/api/sla/feed` and `/api/internal/alerts/run`; ingestion allows its two paths; dashboard 404s `/api/ingest/pir-approved`; missing `SERVICE_ROLE` throws; `"Dashboard "` (case or space variant) throws.

**Commit:** `feat(app): deny-by-default routing per SERVICE_ROLE`

---

## Task 20: Corrections — modal, submission, transaction, route

Four commits, each green.

**20a — writer:** `applyCorrection(db, { pirKey, expectedVersion, after: CaptureRow[], reason, correctedBy }, now): Promise<{ kind: "applied"; version } | { kind: "stale" }>`, in one transaction. It locks the review and returns `stale` if `version ≠ expectedVersion`. Otherwise it reads the before rows, inserts `sla_outage_corrections`, deletes rows absent from `after`, and upserts `after` as `human_corrected` with `reviewed_by` and `reviewed_at = now`. It clears `unresolved_values`, stores the corrected values as the review's extracted values, and increments `version`.
Tests (design §4): removing a partner deletes its rows; removing a service deletes its rows; a second correction on the same version returns `stale` and writes nothing; every correction writes before/after; clearing every partner leaves zero rows, and a later redelivery leaves them at zero (D5).
Commit: `feat(ingestion): transactional corrections with history`

**20b — modal:** `correctionModal({ review, rows, version })` builds a partner multi-select with options from `PARTNERS`, prefilled from rows, and a service multi-select with options from `SERVICES` (D2). It also has a datetime for `incident_started` (UTC), a number for minutes, a static select for severity from `SEVERITIES`, and a reason field. `private_metadata = {pirKey, version}`. `parseCorrectionSubmission(view)` returns rows or field errors (minutes > 0; at least one service if any partner is selected).
Tests: prefill from rows; prefill from review values when there are zero rows (D4); options come only from the registry; validation errors.
Commit: `feat(ingestion): correction modal from the registry`

**20c — handler:** `handleSlackInteraction(payload, deps)`.
- `block_actions`/`correct` loads the review and rows, then calls `openView`.
- `view_submission` parses and applies. A `stale` result returns `{ response_action: "errors" }` with *"someone else just corrected this; reopen to see the latest."*
- On success it returns `{ response_action: "clear" }` plus a `followUp` function that runs `updateMessage` with the new values and the corrector's name, then `triggerAlertRun`. The follow-up logs failures (design §4 table).
- `reviewed_by` = `payload.user.username`.
Tests: stale → the error text and no follow-up; success → a follow-up that edits and triggers; `chat.update` failure is logged and doesn't throw.
Commit: `feat(ingestion): handle Correct clicks and modal submissions`

**20d — route:** `src/app/api/slack/interactions/route.ts` reads `await request.text()` once, verifies (Task 14), and parses the `payload=` form field. It calls the handler, returns its body, and schedules `followUp` with `after()` from `next/server` (D7). Signature failure → 401.
Tests: 401 on a bad signature; a valid submission returns JSON and registers the follow-up (mock `after`).
Commit: `feat(ingestion): Slack interactions route`

---

## Task 21: Ingestion health on the dashboard

Two commits.

**21a — data and feed:** `loadIngestionHealth(db)` in `src/data/pir-reviews.ts` returns `failed` (key, error, updated_at), `unresolved` (key, values) for captured PIRs, and `withoutMessage` (key, slack_error). `getSlaHealth` and the feed envelope gain `ingestion`. **Technical and system viewers get the full list; business gets counts only**, keeping the §8.2 rule of no ticket keys. `FeedSources` gains an `ingestion` stand-in.
Tests: PGlite loader cases; the business payload contains no PIR key (extend `tests/feed/business-payload.test.ts`).
Commit: `feat(feed): report failed and unresolved PIRs in health`

**21b — UI:** `health-panel.tsx` gains three metrics and lists: failed PIRs, PIRs with unresolved values, and captured without a Slack message (with Slack's error). PIR keys link to `pir_url`. Tokens only, per `.claude/rules/design.md`.
Tests: extend `tests/app/dashboard-render.test.tsx` so each list renders, and "None" renders when empty.
Commit: `feat(dashboard): ingestion health in the data health panel`

---

## Task 22: Clean up n8n references and document the module

**Files:** `src/app/api/internal/alerts/run/route.ts` (comment), `src/ingestion/README.md`, `src/data/README.md`, `src/app/README.md`, `.env.example` (all A2 vars, with `SLACK_CHANNEL_INGESTION` noted as `C0BUT8U637Y`), `README.md`
**Action:** Modify

`grep -rn "n8n" src scripts tests` should return nothing except historical notes. Create `.claude/rules/ingestion.md` locally only, if the user keeps `.claude/*` ignored (see Conflicts).

**Commit:** `docs: ingestion module boundaries and configuration`

---

## Task 23: Deploy runbook

**File:** `docs/deploy.md`
**Action:** Create

- Build the image once and deploy two services:
  - `sla-dashboard`: internal ingress, `SERVICE_ROLE=dashboard`, `DATABASE_URL` as `app_user`
  - `sla-ingestion`: public ingress, `SERVICE_ROLE=ingestion`, `INGESTION_DATABASE_URL` as `ingestion_writer`, **min instances 1, CPU always allocated** (D7), Direct VPC egress
- Give the ingestion service account `roles/run.invoker` on `sla-dashboard`.
- The Cloud Scheduler job runs at `0 1,13 * * *` UTC with an OIDC token and the secret header.
- Create roles before migrations.
- Keep OQ-4 (Cloud SQL connection method, SSO) marked open.

**Commit:** `docs: deployment runbook for the two Cloud Run services`

---

## Task 24: Final verification

Run `pnpm test && pnpm lint && pnpm typecheck && pnpm build`. Then run `SERVICE_ROLE= pnpm build && SERVICE_ROLE= pnpm start` and confirm startup fails. Then use `@verification-before-completion` and `@finishing-a-development-branch`.

## Manual cutover checklist (not code)

1. Infra creates the `app_user` and `ingestion_writer` roles, then run migrations on the GCP database.
2. Import the historical spreadsheet with `source = 'backfill'`. This is manual, because no script was planned (D8).
3. Deploy both services per `docs/deploy.md`.
4. Set the Slack Interactivity Request URL to `sla-ingestion/api/slack/interactions`, and invite the bot to `C0BUT8U637Y`.
5. Point the Jira Automation webhook at `/api/ingest/pir-approved` with body `{ "issueKey": "{{issue.key}}" }` and the `Jira-Webhook-Token` header.
6. Create the Cloud Scheduler job.
7. Capture and correct a test PIR end to end.
8. Archive n8n workflow `ayGR5EibR4xQOf45`.
