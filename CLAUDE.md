# SLA tracking app

## Commands
- `pnpm test`, `pnpm lint`, `pnpm typecheck` — run all three before calling a task done

## Design authority
- Specs live in `specs/`. Read the relevant one before starting a task.
  Where code and spec disagree, the spec wins; tell me about the conflict.
- Current work: `2026-09-25-ingestion-in-app-design.md`

## Invariants
- Dashboard and alerts call the same evaluate(); never a second implementation
- Every route: `dynamic = 'force-dynamic'` and no-store
- Ambiguity in a spec: stop and ask, don't pick something reasonable