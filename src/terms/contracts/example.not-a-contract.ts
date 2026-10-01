import type { HandAuthoredTermsFile } from "../types";

/**
 * FORMAT SPECIMEN. NOT A CONTRACT.
 * Every number below is invented so the shape can be reviewed.
 * Do not copy a figure into a real file. Do not set lifecycle to contract_bound
 * on this file. StaticTermsProvider will not return it while lifecycle stays
 * terms_pending_review, and it rejects the file if example and contract_bound
 * are set together.
 *
 * Percentages are written as the contract writes them. loadContractFile converts
 * them into fractions and below-threshold tiers.
 */
export const EXAMPLE_NOT_A_CONTRACT = {
  example: true,
  partner: "scopely",
  lifecycle: "terms_pending_review",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  contractAggregateCap: null,
  scopes: [
    {
      kind: "service",
      scopeId: "example-payments",
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
      sourceClause: "EXAMPLE — not a contract clause",
    },
    {
      kind: "catch_all",
      scopeId: "example-catch-all",
      includesScopedServices: true,
      target: 99.9,
      penalty: {
        kind: "tiers",
        perScopeCap: null,
        tiers: [
          { atOrAbove: 99.9, credit: 0 },
          { atOrAbove: 99, credit: 5 },
          { atOrAbove: 0, credit: 10 },
        ],
      },
      sourceClause: "EXAMPLE — not a contract clause",
    },
  ],
} satisfies HandAuthoredTermsFile;
