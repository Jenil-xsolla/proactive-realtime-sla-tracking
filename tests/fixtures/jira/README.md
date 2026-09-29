# Jira PIR fixtures

These fixtures are recorded Jira REST v3 issues, shaped as `{ "key": ..., "fields": {...} }`,
for five real PIRs (`GTO-543`, `GTO-1917`, `GTO-200`, `GTO-2454`, `GTO-913`) and their linked
incidents (`GTO-542`, `GTO-1916`, `GTO-199`, `GTO-1756`; `GTO-913` has no incident link).

Provenance: structured fields (`customfield_31331`, `customfield_11646`, `customfield_10399`,
`issuelinks` type/keys, `customfield_10068`) are copied verbatim from the recorded source data.
The rich-text field `customfield_13920` is not available as raw ADF from the source, so it is
rebuilt as ADF here using the node shapes the field is known to use: `doc > paragraph > text`,
`inlineCard` with `attrs.url`, and `bulletList > listItem > paragraph > text`. `issuelinks`
entries are trimmed to `{ id, type: { id, name }, outwardIssue|inwardIssue: { key } }` — nested
summary/status/priority fields are removed.

These fixtures must be verified against a real REST payload at cutover, particularly the
rebuilt `customfield_13920` ADF shape.

## Cases

- **GTO-543** — single service (IGS-BB), L1, 42 minutes. `customfield_13920` holds only a
  Google Sheets smartlink (legacy format): no partner match, one unresolved value.
- **GTO-1917** — two services (CorpSite, IGS-BB), L2, 680 minutes. `customfield_13920` is
  null: zero partners, no unresolved value.
- **GTO-200** — Payments, L1, 25 minutes. `customfield_13920` holds a heading plus a bullet
  list of merchant names (legacy prose). Under the merchant scan: Roblox, Niantic, Scopely,
  Bandai Namco, Netmarble, Nexters and Twitch resolve via alias/displayName word-boundary
  matches; Valve, VoyagerOne and MY.GAMES are non-pilot and simply not matched.
- **GTO-2454** — no outage: `customfield_31331` is `0` (and severity is L3) → skipped as
  `no_outage`.
- **GTO-913** — L4 — Minor with 291 minutes → skipped as `below_l2`. It also has no `11031`
  incident link (only a `10006` Problem/Incident link) — the severity skip must be decided
  before the incident link is required.
