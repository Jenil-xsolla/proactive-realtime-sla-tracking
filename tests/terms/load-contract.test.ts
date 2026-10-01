import { describe, expect, it } from "vitest";
import type { ContractFile, ContractScope } from "@/terms";
import { loadContractFile } from "@/terms/load-contract";

/**
 * Illustrative figures only. Not a real contract.
 * at or above 99.95 -> 0, 99.50 -> 5, 99.00 -> 10, 0 -> 25.
 */
const ILLUSTRATIVE_TIERS = [
  { atOrAbove: 99.95, credit: 0 },
  { atOrAbove: 99.5, credit: 5 },
  { atOrAbove: 99, credit: 10 },
  { atOrAbove: 0, credit: 25 },
] as const;

function scope(overrides: Partial<ContractScope> = {}): ContractScope {
  return {
    kind: "service",
    scopeId: "payments",
    services: ["payments"],
    target: 99.95,
    penalty: { kind: "tiers", perScopeCap: null, tiers: [...ILLUSTRATIVE_TIERS] },
    sourceClause: "Schedule A, section 4",
    ...overrides,
  };
}

function file(overrides: Partial<ContractFile> = {}): ContractFile {
  return {
    partner: "scopely",
    lifecycle: "contract_bound",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [scope()],
    ...overrides,
  };
}

describe("loadContractFile", () => {
  it("shifts each band's credit onto the threshold of the band above it", () => {
    const loaded = loadContractFile(file());
    const terms = loaded.scopes[0]?.terms;

    expect(loaded.warnings).toEqual([]);
    expect(terms?.target).toBe(0.9995);
    expect(terms?.penaltyKind).toBe("tiers");
    expect(terms?.penaltyTiers).toEqual([
      { belowAvailability: 0.9995, creditFraction: 0.05 },
      { belowAvailability: 0.995, creditFraction: 0.1 },
      { belowAvailability: 0.99, creditFraction: 0.25 },
    ]);
    expect(terms).not.toHaveProperty("exclusions");
  });

  it("expands a combined service list, including services a named service contains", () => {
    const loaded = loadContractFile(
      file({
        scopes: [
          scope({ scopeId: "checkout", services: ["payments", "login"] }),
          scope({ scopeId: "storefront", services: ["webshop"] }),
        ],
      }),
    );

    expect(loaded.scopes.map((entry) => (entry.kind === "service" ? entry.services : []))).toEqual([
      ["payments", "login"],
      ["webshop", "igs-bb", "subscriptions", "shop-builder"],
    ]);
  });

  it("converts none and not_entered without inventing a zero credit", () => {
    const loaded = loadContractFile(
      file({
        scopes: [
          scope({
            scopeId: "no-penalty",
            penalty: { kind: "none" },
          }),
          scope({
            scopeId: "unentered",
            services: ["login"],
            penalty: { kind: "not_entered" },
          }),
        ],
      }),
    );

    expect(loaded.scopes.map((entry) => entry.terms.penaltyKind)).toEqual(["none", "not_entered"]);
    expect(loaded.scopes.map((entry) => entry.terms.penaltyTiers)).toEqual([[], []]);
  });

  it("rejects tiers that are not strictly decreasing by atOrAbove", () => {
    expect(() =>
      loadContractFile(
        file({
          scopes: [
            scope({
              penalty: {
                kind: "tiers",
                perScopeCap: null,
                tiers: [
                  { atOrAbove: 99.5, credit: 0 },
                  { atOrAbove: 99.95, credit: 5 },
                  { atOrAbove: 0, credit: 25 },
                ],
              },
            }),
          ],
        }),
      ),
    ).toThrow(/strictly decreasing/);
  });

  it("rejects a last tier whose atOrAbove is not 0", () => {
    expect(() =>
      loadContractFile(
        file({
          scopes: [
            scope({
              penalty: {
                kind: "tiers",
                perScopeCap: null,
                tiers: [
                  { atOrAbove: 99.95, credit: 0 },
                  { atOrAbove: 99.5, credit: 5 },
                ],
              },
            }),
          ],
        }),
      ),
    ).toThrow(/atOrAbove must be 0/);
  });

  it("rejects a target outside 0 to 100", () => {
    expect(() => loadContractFile(file({ scopes: [scope({ target: 100.01 })] }))).toThrow(/0 to 100/);
    expect(() => loadContractFile(file({ scopes: [scope({ target: -0.01 })] }))).toThrow(/0 to 100/);
  });

  it("rejects a service scope with no services", () => {
    expect(() => loadContractFile(file({ scopes: [scope({ services: [] })] }))).toThrow(/at least one service/);
    expect(() => loadContractFile(file({ scopes: [scope({ services: undefined })] }))).toThrow(
      /at least one service/,
    );
  });

  it("rejects a catch-all that does not state includesScopedServices", () => {
    expect(() =>
      loadContractFile(
        file({
          scopes: [
            {
              kind: "catch_all",
              scopeId: "rest",
              target: 99.95,
              penalty: { kind: "none" },
              sourceClause: "Schedule A",
            },
          ],
        }),
      ),
    ).toThrow(/includesScopedServices/);
  });

  it("warns when sourceClause is missing and still converts the file", () => {
    const loaded = loadContractFile(
      file({
        scopes: [scope({ sourceClause: undefined })],
      }),
    );

    expect(loaded.scopes).toHaveLength(1);
    expect(loaded.scopes[0]?.terms.target).toBe(0.9995);
    expect(loaded.warnings).toEqual(['Scope "payments" has no sourceClause.']);
  });
});
