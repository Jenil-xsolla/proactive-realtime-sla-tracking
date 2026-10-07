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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
