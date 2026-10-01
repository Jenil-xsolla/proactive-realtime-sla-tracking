import "@/terms/fixture-guard";
import type { SelectableTermsFile } from "@/terms/select";
import type { SlaTerms } from "@/terms/types";

function fixtureTerms(overrides: Partial<SlaTerms> = {}): SlaTerms {
  return {
    target: 0.999,
    window: "calendar_month",
    timezone: "UTC",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    penaltyKind: "tiers",
    penaltyTiers: [
      { belowAvailability: 0.999, creditFraction: 0.1 },
      { belowAvailability: 0.99, creditFraction: 0.25 },
    ],
    perScopeCap: 0.5,
    contractAggregateCap: 1,
    minimumCountableOutageMinutes: 5,
    sourceClause: "FIXTURE — not a contract clause",
    monthlyFee: { amount: 10000, currency: "XXX" },
    ...overrides,
  };
}

/** Engine-test terms. Not a contract. Both catch-all inclusion values are written out. */
export const FIXTURE_TERMS_FILES = [
  {
    partner: "scopely",
    lifecycle: "contract_bound",
    scopes: [
      {
        kind: "service",
        scopeId: "fixture-scopely-payments",
        services: ["payments"],
        terms: fixtureTerms(),
      },
      {
        kind: "catch_all",
        scopeId: "fixture-scopely-catch-all",
        includesScopedServices: true,
        terms: fixtureTerms({
          sourceClause: "FIXTURE — catch-all includes specifically scoped services",
        }),
      },
    ],
  },
  {
    partner: "niantic",
    lifecycle: "contract_bound",
    scopes: [
      {
        kind: "service",
        scopeId: "fixture-niantic-payments",
        services: ["payments"],
        terms: fixtureTerms({ monthlyFee: null }),
      },
      {
        kind: "catch_all",
        scopeId: "fixture-niantic-catch-all",
        includesScopedServices: false,
        terms: fixtureTerms({
          monthlyFee: null,
          perScopeCap: null,
          contractAggregateCap: null,
          sourceClause: "FIXTURE — catch-all excludes specifically scoped services",
        }),
      },
    ],
  },
  {
    partner: "kabam",
    lifecycle: "terms_pending_review",
    scopes: [
      {
        kind: "catch_all",
        scopeId: "fixture-kabam-catch-all",
        includesScopedServices: true,
        terms: fixtureTerms(),
      },
    ],
  },
] satisfies readonly SelectableTermsFile[];
