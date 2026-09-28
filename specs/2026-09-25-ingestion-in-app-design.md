# Ingestion inside the app — design

**Status:** approved 2026-09-25, revised the same day to write-first capture with correction at any time
**Location:** `specs/2026-09-25-ingestion-in-app-design.md`, beside `specs/sla-dashboard-spec.md`

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where ingestion lives | In the app repo, as its own module | `neuronet-automations` is a cron-job repo; it cannot receive Jira webhooks or Slack clicks |
| Deployment | One image, two Cloud Run services | Cloud Run ingress is per service, not per path. The dashboard has no auth and must not be public |
| How PIRs arrive | Jira Automation webhook only | Chosen over polling. Mitigated by recording receipt before any other work |
| Human review | None before the write. Every capture is posted to Slack with a Correct button that works at any time | Attribution is a deterministic lookup, so holding rows for approval does not buy safety. Removes the wait-for-response problem |
| Capture notices | Engineering channel `C0BUT8U637Y` | Every capture and every correction is posted there |
| Partner attribution | Deterministic scan of the merchants field — registry names and aliases matched at word boundaries, digit runs matched against merchant IDs — no model | The field is free text, not one clean token per value, so attribution scans it rather than matching exact tokens |
| Merchant spreadsheets | Not used | Partner attribution reads the merchants field on the PIR; no separate spreadsheet is maintained |
| `ai_reasoning` column | Dropped | No model output to store |
| `decision_type` values | `system_written` (written by ingestion, not yet corrected), `human_corrected` (changed through the correction form) | Distinguishes rows written by ingestion from rows a person has corrected |
| Correction history | Every correction recorded in `sla_outage_corrections` | The first correction would otherwise overwrite what the system wrote, leaving no trail in a dispute |
| Scheduled alert trigger | Cloud Scheduler, 01:00 and 13:00 UTC | Native to Cloud Run |
| Schema ownership | The repo owns `sla_outages`, `sla_pir_reviews`, `sla_outage_corrections` and `sla_alert_state` | The GCP database is new; nothing to migrate from the test database |

## 1. Components and boundaries

### Deployment

The Next.js app is built once and deployed as two Cloud Run services, selected by `SERVICE_ROLE`:

| Service | Ingress | Serves | Database credential |
| --- | --- | --- | --- |
| `sla-dashboard` | Internal | Dashboard, feed, `/api/internal/alerts/run` | App: read `sla_outages`, `sla_pir_reviews` and `sla_outage_corrections`; write `sla_alert_state` |
| `sla-ingestion` | Public | `/api/ingest/pir-approved`, `/api/slack/interactions` only | Ingestion: write `sla_outages`, `sla_pir_reviews` and `sla_outage_corrections` |

Middleware is deny-by-default. The ingestion role answers only its two paths and returns 404 for everything else. A missing or unrecognised `SERVICE_ROLE` stops the app at startup, because one wrong variable would otherwise make the dashboard public.

After an upsert, ingestion calls the dashboard's `/api/internal/alerts/run` over Direct VPC egress with a Cloud Run identity token. Cloud Scheduler calls the same endpoint on its schedule, so alert logic has one owner.

### Module layout

```
src/ingestion/
  jira/         fetch PIR and linked incident; extract fields
  resolution/   registry lookup: merchant ID first, then name
  notify/       capture message, correction modal, interaction handling
  writer.ts     sla_outages upsert
```

The engine and feed are unchanged. An ESLint rule stops anything outside `src/ingestion/` from importing `writer.ts` or the ingestion database client.

`src/registry/services.ts` gains the ARI-to-service map, held in the registry. The registry now drives the service mapping, partner resolution and the correction form's options. Adding a partner or service is a change in one place.

### Schema

**`sla_outages`**, now owned by the repo:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | |
| `pir_key` | text not null | |
| `partner` | text not null | display name |
| `partner_id` | text | external merchant ID, not a foreign key |
| `incident_started` | timestamptz not null | UTC |
| `affected_service` | text not null | |
| `outage_minutes` | numeric not null | > 0 |
| `severity` | text | |
| `source` | text not null | `pipeline` or `backfill` |
| `decision_type` | text | `system_written` or `human_corrected`; null only for backfill rows |
| `reviewed_by` | text | Slack username of the last corrector; null unless `human_corrected` |
| `reason` | text | from the correction form |
| `reviewed_at` | timestamptz | time of the last correction; null unless `human_corrected` |
| `pir_url` | text | |

Unique on `(pir_key, partner, affected_service)`. A PIR affecting several services writes one row per (partner, service), identical apart from `affected_service` (D2). Check constraints: `decision_type` is null if and only if `source = 'backfill'`; `reviewed_by` is set if and only if `decision_type = 'human_corrected'`.

**`sla_pir_reviews`**, keyed on `pir_key`: an ingestion log. Status (`received`, `skipped`, `captured`, `failed`), the extracted values (`incident_started`, `outage_minutes`, affected services, severity, `pir_url`) so the correction modal can prefill even when the PIR has zero rows (D4), unresolved values typed as `{ kind: 'merchant' | 'service_ari', raw }` (D6), the Slack channel and message timestamp, a version number incremented on every correction, error text, and received and updated timestamps. It makes a half-processed PIR visible instead of lost.

**`sla_outage_corrections`**: one row per correction. `pir_key`, corrected by (Slack username), corrected at, the rows before and after (JSON), and the reason given.

**`sla_alert_state`**: unchanged.

## 2. Ingestion flow

1. Jira Automation posts `{ issueKey }` to `/api/ingest/pir-approved` with a shared-secret header.
2. **Record receipt first.** Insert into `sla_pir_reviews` with status `received`. A PIR already `captured` is handled as a redelivery (below).
3. **Work inside the request.** Cloud Run throttles CPU after the response is sent, so background work silently stalls. Fetch the PIR. Outage minutes come from Jira field `customfield_31331` (D1); see the failure table (§4) for missing, zero or non-numeric values. Fetch the linked incident; see the failure table for a missing incident link or a missing incident field. Extract severity — see the failure table for L3/L4, a missing severity, and an unrecognised severity label — affected services (ARIs) and affected merchants.
4. **Map ARIs and resolve merchants.** Map each ARI to its service through the registry; an ARI missing from the map is skipped and flagged as an unresolved value (`{ kind: 'service_ari', raw }`) — it does not fail the PIR (D6). The merchants field (`customfield_13920`, ADF) is read by deterministic scan of the normalised text, not split into tokens (E2): every standalone digit run (`\b\d+\b`) is a merchant-ID candidate, and every registry partner display name or alias found at word boundaries in the text is a name match. No model is involved. A merchant-ID match wins over a name match for the same partner, and matched partners dedupe by registry id. A digit run matching no registry `merchantIds` entry is a non-pilot merchant: it is ignored, not treated as unresolved, and its count is reported in the capture message (E1). If the text has no pilot-partner match and no digit run at all, the whole trimmed field text is recorded as one unresolved value (`{ kind: 'merchant', raw }`) so a person sees it; a null or empty field yields zero partners and no unresolved value. Each merchant value resolves into resolved partners, ignored non-pilot IDs, and unresolved values.
5. **Write immediately.** Upsert one `sla_outages` row per resolved partner × mapped service — identical apart from `affected_service` (D2) — with `decision_type = system_written`, `source = pipeline`, no reviewer. Set status `captured`.
6. Post the capture message to the engineering channel and save its reference.
7. Trigger the alert run, then respond 200.

**Redelivery.** Whether a PIR is already corrected is decided per PIR, from its version number in `sla_pir_reviews` (`version > 0`), not per row (D5). If the version is 0, redelivery replaces the PIR's system-written row set wholesale: rows are upserted from the fresh Jira read, and rows Jira no longer lists are deleted; the existing capture message is edited in place, not re-posted (A9). If the version is greater than 0, the PIR is already corrected — its rows are never touched, even when a correction left it with zero rows — and the channel gets a note that Jira changed after a correction, so a person decides. Redelivery of a PIR still `received` (an earlier attempt died mid-request) or `skipped` re-runs it the same way as `failed` (A8). If an already-captured PIR now reads as no outage or below L2, its rows and status are left unchanged and the channel gets a note, so a person decides; a correction that clears every partner removes it. A row lock (`SELECT … FOR UPDATE`) on the PIR's `sla_pir_reviews` row serialises concurrent deliveries.

**On failure at any step:** status `failed` with the error text, a notice to the engineering channel, and a 200 response, because Jira Automation does not retry. The PIR stays on record. Re-triggering its Jira Automation rule re-runs it; receipt handling allows `failed` to move back to `received`.

The dashboard's health panel shows failed PIRs and captured PIRs with unresolved values.

## 3. Capture message and corrections

**Capture message**, posted to `C0BUT8U637Y`:

> GTO-543 captured. It will appear on the dashboard.

followed by `pir_key` (linked), and for each row: partner, `partner_id`, `incident_started`, `affected_service`, `outage_minutes` and severity. The message states the count of non-pilot merchant IDs ignored, if any (E1). Unresolved merchant values are still listed prominently, since they produce no rows until corrected. One button: **Correct**. It stays usable for as long as the message exists.

**Correction modal:** a multi-select of registry partners prefilled with the current rows, a multi-select of registry services (`affected_service`) prefilled with the current rows (D2), fields for `incident_started`, `outage_minutes` and severity prefilled with current values, and a reason field. The partner and service options come from the registry. Clearing every partner means no pilot partner was affected.

**Handling a correction:**

1. Verify Slack's signature on the raw body. Reject timestamps older than five minutes.
2. The modal carries the review's version number. If it no longer matches, refuse with "someone else just corrected this; reopen to see the latest."
3. In one transaction: record the before and after in `sla_outage_corrections`, replace the partner×service set — delete this PIR's rows for any (partner, service) pair no longer listed, and upsert the rest — with `decision_type = human_corrected`, `reviewed_by` set to the corrector's Slack username and `reviewed_at` to now, and increment the version. A plain upsert is not enough: a removed partner or service would leave a stale row that keeps counting.
4. Edit the capture message to show the current values and who last corrected them.
5. Trigger the alert run.

Slack requires a response within three seconds, and the modal must open within that window. `sla-ingestion` therefore runs with minimum instances set to 1 and CPU always allocated, instance-based billing, so a cold start never breaks a click and work started after the response keeps running (D7). The route commits, responds within the window, then runs `chat.update` and the alert trigger inside `after()`.

**Accepted trade-offs**

- Alerts fire on the system's write, before anyone has looked. A wrong attribution can send one incorrect alert before it is corrected. Every alert carries its PIR keys, so the trail exists. While every partner is tracking-only, only the lighter heads-up can fire.
- Unresolved merchant values produce no rows. The message and the health panel flag them until someone corrects the PIR.

## 4. Failures, tests and cutover

### Failures that need a person

| Failure | Result |
| --- | --- |
| Jira fetch fails, or a required field is missing | `failed`, engineering notified |
| Missing or zero `customfield_31331` (outage minutes) | `skipped` — no outage on this PIR (A3) |
| Non-numeric `customfield_31331` | `failed` (A3) |
| Missing incident link (type `11031`), or missing incident field `customfield_10068` | `failed`. The PIR's `created` time is a different moment that would skew the timeline, so this design does not fall back to it (A4) |
| Missing severity (`customfield_11646.value`) | `failed` (A6) |
| Severity is L3 or L4 (`"L3 — Limited"`, `"L4 — Minor"`) | `skipped` — only L0–L2 PIRs are captured, with a reason (E4) |
| Severity label is neither L0–L4 | `failed` — unrecognised severity (E4) |
| Database write fails | `failed`, engineering notified; no capture message posted |
| Slack rejects the capture message (`ok: false`) | Rows are written and visible on the dashboard. Retrying the same channel would likely fail the same way, so the PIR is flagged in the health panel as captured without a message, with Slack's error |
| Slack rejects the message edit after a correction | The correction is saved; logged, not retried |
| Alert trigger fails | Logged; the next scheduled run catches up |

### Tests

- Resolution: digit runs matched as merchant IDs, names and aliases matched at word boundaries, a non-pilot merchant ID ignored and counted, text with no partner and no digit run recorded as one unresolved value, and an empty field producing no partners and no unresolved value.
- Severity: L3 and L4 are `skipped` with a reason; an unrecognised severity label is `failed`.
- Signature verification, including a stale timestamp and a tampered body.
- A correction that removes a partner deletes that partner's row.
- Two corrections against the same version: the second is refused.
- Every correction writes a before/after record.
- Redelivery of an uncorrected PIR (version = 0) replaces its system-written rows from Jira, deleting rows Jira no longer lists; redelivery of a corrected PIR (version > 0) leaves its rows untouched and posts the Jira-changed note.
- Receipt-first: a failure after receipt leaves a `failed` row, not nothing.
- Role gating: the ingestion role returns 404 for dashboard paths, and a missing `SERVICE_ROLE` fails startup.
- Writer: `decision_type` and `reviewed_by` check constraints, including backfill rows.
- Jira field extraction from recorded fixture payloads.

### Cutover

1. Run migrations on the new GCP database.
2. Import the historical spreadsheet with `source = 'backfill'`.
3. Deploy both services. Set minimum instances to 1 on `sla-ingestion`.
4. Set the Slack app's Interactivity Request URL to `sla-ingestion`'s `/api/slack/interactions`, and invite the bot to `C0BUT8U637Y`.
5. Point the Jira Automation webhook at `/api/ingest/pir-approved`.
6. Create the Cloud Scheduler job for `/api/internal/alerts/run`.
7. Capture and correct a test PIR end to end before relying on it.

## Open questions

None outstanding. Closed 2026-09-25: redelivery after a correction (handled in section 2), and the engineering channel (`C0BUT8U637Y`).

## Relationship to the main spec

`specs/sla-dashboard-spec.md` was updated on 2026-09-28 to match this design: data boundary, AD-1 (two Cloud Run services), AD-7 (triggers), new AD-8 (in-app ingestion), §4 layout, §5 schema and ownership, §8.3 routes, §10 alerting triggers, and the open questions. Where the two overlap on ingestion, this document is more detailed.

**2026-09-28.** Per-service outage rows (one row per partner×service, unique on `(pir_key, partner, affected_service)`) and per-PIR correction state (decided from the PIR's version number, not per row) were decided during planning for this build. Both documents were updated to match.

**2026-09-28.** E1–E4 (non-pilot merchant IDs, the merchant-scan rule, and the L3/L4 severity rule) were decided after inspecting real PIRs (GTO-1549, GTO-1624, GTO-200, GTO-913). Ticket generation is being automated, so the affected-merchants field will hold merchant IDs going forward (E3).
