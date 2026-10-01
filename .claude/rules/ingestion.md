---
description: Ingestion writes outage rows immediately and keeps a trail of every change
globs: "src/ingestion/**"
alwaysApply: false
---

# Ingestion

Design authority: `specs/2026-09-25-ingestion-in-app-design.md`. Where it and the code disagree, the spec wins.

- Record receipt in `sla_pir_reviews` before any other work. A failure after receipt leaves a `failed` row, never nothing.
- Do all work inside the request. Cloud Run throttles CPU after the response on `/api/ingest/pir-approved`. Only the Slack interactions route may use `after()`, because `sla-ingestion` runs with CPU always allocated.
- Jira Automation does not retry. `/api/ingest/pir-approved` returns 200 for every outcome after receipt, and records the error instead.
- Attribution is a deterministic scan of the merchants field, not exact tokens: every standalone digit run (`\b\d+\b`) is a merchant-ID candidate, and every registry partner display name or alias found at word boundaries in the normalised text is a name match. A merchant-ID match wins over a name match for the same partner. A digit run matching no registry `merchantIds` entry is a non-pilot merchant — ignored, not unresolved, and counted in the capture message. No model, no substring match, no guessing.
- One row per (partner, service). The idempotency key is `(pir_key, partner, affected_service)`.
- A PIR is "corrected" when its review `version > 0`. Redelivery never touches a corrected PIR's rows. A correction replaces the PIR's whole row set and writes a before/after record in `sla_outage_corrections`, all in one transaction.
- A PIR already `captured` is never downgraded by redelivery: if it now reads as no outage or below L2, its rows and status are left unchanged and the channel gets a note, so a person decides.
- Only `src/ingestion/**` imports `writer.ts` or `db.ts`. ESLint enforces it.
- Slack delivery counts only when the response body has `ok: true`. Verify the Slack signature on the raw body, and reject timestamps older than five minutes.
- Every outbound fetch takes an injectable `fetch` and uses `cache: "no-store"`. Time comes from an injected `now`, never `new Date()` in logic under test.

```ts
// ❌ BAD — upsert alone leaves a removed partner's row counting
await upsert(afterRows);

// ✅ GOOD — replace the set, inside the correction transaction
await deleteRowsNotIn(pirKey, afterRows);
await upsert(afterRows);
```
