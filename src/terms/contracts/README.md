# Hand-authored SLA terms

Production reads `sla_contract_terms` through `DbTermsProvider`. This directory is the format specimen `StaticTermsProvider` reads in tests. A real contract is a row in that table, not a file here.

`StaticTermsProvider` converts a file with `loadContractFile`, then returns a scope only when `lifecycle` is `contract_bound` and `asOf` falls inside the effective window. Any other lifecycle is invisible to the engine. An empty result is tracking-only.

Write percentages as the contract writes them. Tiers are at-or-above bands, highest first, and the last `atOrAbove` is 0. The loader turns that into the engine's fractions and `belowAvailability` tiers. Do not write engine fractions in this directory.

A real contract is reviewed field-by-field against the signed document before it is saved as `contract_bound`. This directory does not infer, default, or round a figure.

`example.not-a-contract.ts` is a format specimen. Its figures are invented. It is `example: true` and `terms_pending_review`. Do not copy a number out of it, and do not flip it to `contract_bound`.

Scheduled maintenance and other excluded events never become outage rows. Terms files have no exclusion list.

## Tests

Pass a `HandAuthoredTermsFile` to `StaticTermsProvider`. Do not register a real contract in `index.ts`. Production saves go through `saveContractTerms`, which writes one row per partner and increments `version`.

## File shape

```ts
import type { HandAuthoredTermsFile } from "../types";

export const PARTNER_TERMS = {
  partner: "scopely",
  lifecycle: "contract_bound",
  effectiveFrom: "2026-03-01",
  effectiveTo: null,
  contractAggregateCap: null,
  scopes: [
    {
      kind: "service",
      scopeId: "scopely-payments",
      services: ["payments"],
      target: 99.9,
      penalty: {
        kind: "tiers",
        perScopeCap: 50,
        tiers: [
          { atOrAbove: 99.9, credit: 0 },
          { atOrAbove: 0, credit: 10 },
        ],
      },
      sourceClause: "Schedule A, section 4.2",
    },
    {
      kind: "catch_all",
      scopeId: "scopely-other-services",
      includesScopedServices: false,
      target: 99.9,
      penalty: { kind: "none" },
      sourceClause: "Schedule A, section 4.3",
    },
  ],
} satisfies HandAuthoredTermsFile;
```

The snippet above is documentation. It is not Scopely's contract, and the numbers are not defaults.

## Fields

| Field | How to fill it |
| --- | --- |
| `lifecycle` | `terms_pending_review` until the pull request confirms every field. `contract_bound` after that. `tracking_only` is not a file state; it is the empty result when no bound scope is in force. |
| `effectiveFrom` | Calendar date the contract starts these terms, `YYYY-MM-DD`, UTC midnight. Not the upload date. Evaluation uses the later of this date and 2026-01-01. A start inside a month prorates that month. |
| `effectiveTo` | Last calendar date the terms apply, inclusive, or `null` when the contract states no end. |
| `contractAggregateCap` | Maximum credit percent across scopes, or `null` when the contract states no aggregate cap. |
| `kind` | `service` for one or more named services with one target. `catch_all` for the remainder, or for a clause that covers every service. |
| `services` | Registry ids, on `service` scopes only. One id is the common case. Several ids share one target. A service that lists others in the registry (`webshop` includes `igs-bb`, `subscriptions`, and `shop-builder`) expands to that full set. |
| `includesScopedServices` | Catch-all only. Copy the contract. `true` when an outage in a specifically scoped service also consumes this allowance. `false` when this allowance covers only services no specific scope names. The field is required. Omitting it is an error. There is no default, and the specimen's `true` is not a hint. |
| `target` | Uptime percent as written. `99.9` is 99.9%. From 0 to 100. |
| `penalty` | `none` when the contract has no penalty. `not_entered` when a penalty exists and its figures are not in the file yet. `tiers` for an at-or-above table: highest percent first, last `atOrAbove` is 0, `credit` is the percent, `perScopeCap` is a percent or `null`. |
| `sourceClause` | The clause each figure came from. A missing clause is a warning, not a rejection, because some files were entered without one. |

`asOf` is compared to the converted `effectiveFrom` and `effectiveTo` as instants. A scope is in force when `effectiveFrom <= asOf` and (`effectiveTo` is null or `asOf <= effectiveTo`).
