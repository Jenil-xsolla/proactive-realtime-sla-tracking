import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PARTNERS, type PartnerId } from "@/registry";
import { EmptyTermsProvider, StaticTermsProvider, loadContractFile } from "@/terms";
import type { ContractScope, HandAuthoredTermsFile, SlaScope } from "@/terms";
import { EXAMPLE_NOT_A_CONTRACT } from "@/terms/contracts/example.not-a-contract";

const AS_OF = new Date("2026-06-15T00:00:00.000Z");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

function scope(overrides: Partial<ContractScope> = {}): ContractScope {
  return {
    kind: "service",
    scopeId: "payments",
    services: ["payments"],
    target: 99.9,
    penalty: { kind: "none" },
    sourceClause: "FIXTURE — not a contract clause",
    ...overrides,
  };
}

function boundFile(
  partner: PartnerId,
  scopes: ContractScope[],
  lifecycle: HandAuthoredTermsFile["lifecycle"] = "contract_bound",
  dates: { effectiveFrom?: string; effectiveTo?: string | null } = {},
): HandAuthoredTermsFile {
  return {
    partner,
    lifecycle,
    effectiveFrom: dates.effectiveFrom ?? "2026-01-01",
    effectiveTo: dates.effectiveTo ?? null,
    contractAggregateCap: null,
    scopes,
  };
}

describe("EmptyTermsProvider", () => {
  it("returns an empty scope list for all eleven partners", async () => {
    expect(PARTNERS).toHaveLength(11);

    const provider = new EmptyTermsProvider();
    const instants = [new Date("2020-01-01T00:00:00.000Z"), AS_OF];

    for (const partner of PARTNERS) {
      for (const instant of instants) {
        expect(await provider.listScopes(partner.id, instant)).toEqual([]);
      }
    }
  });
});

describe("StaticTermsProvider", () => {
  it("returns no scopes while the contracts directory holds only the example", async () => {
    const provider = new StaticTermsProvider();

    for (const partner of PARTNERS) {
      expect(await provider.listScopes(partner.id, AS_OF)).toEqual([]);
    }
  });

  it("keeps the worked example unmarked as a binding contract", () => {
    expect(EXAMPLE_NOT_A_CONTRACT.example).toBe(true);
    expect(EXAMPLE_NOT_A_CONTRACT.lifecycle).toBe("terms_pending_review");
  });

  it("registers every file in src/terms/contracts", () => {
    const dir = path.resolve("src/terms/contracts");
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts") && name !== "index.ts");
    const index = readFileSync(path.join(dir, "index.ts"), "utf8");

    expect(files).toContain("example.not-a-contract.ts");
    for (const file of files) {
      expect(index, file).toContain(file.replace(/\.ts$/, ""));
    }
  });

  it("returns contract_bound scopes whose effective window contains asOf", async () => {
    const file = boundFile("roblox", [scope({ scopeId: "roblox-payments" })]);
    const provider = new StaticTermsProvider([file]);

    expect(await provider.listScopes("roblox", AS_OF)).toEqual(loadContractFile(file).scopes);
    expect(await provider.listScopes("twitch", AS_OF)).toEqual([]);
  });

  it("hides terms_pending_review from listScopes", async () => {
    const file = boundFile("twitch", [scope({ scopeId: "twitch-login", services: ["login"] })], "terms_pending_review");
    const provider = new StaticTermsProvider([file]);

    expect(await provider.listScopes("twitch", AS_OF)).toEqual([]);
  });

  it("omits a contract_bound scope outside its effective window", async () => {
    const closed = boundFile(
      "nexters",
      [scope({ scopeId: "nexters-closed", services: ["login"] })],
      "contract_bound",
      { effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01" },
    );
    const notYet = boundFile(
      "nexters",
      [scope({ scopeId: "nexters-future" })],
      "contract_bound",
      { effectiveFrom: "2026-12-01" },
    );
    const provider = new StaticTermsProvider([closed, notYet]);

    expect(await provider.listScopes("nexters", AS_OF)).toEqual([]);
    expect(await provider.listScopes("nexters", new Date("2026-03-01T00:00:00.000Z"))).toEqual(
      loadContractFile(closed).scopes,
    );
    expect(await provider.listScopes("nexters", new Date("2026-12-01T00:00:00.000Z"))).toEqual(
      loadContractFile(notYet).scopes,
    );
  });

  it("refuses a catch-all scope that does not state includesScopedServices", async () => {
    const file = boundFile("netmarble", [
      {
        kind: "catch_all",
        scopeId: "netmarble-rest",
        target: 99.9,
        penalty: { kind: "none" },
        sourceClause: "FIXTURE — not a contract clause",
      },
    ]);
    const provider = new StaticTermsProvider([file]);

    await expect(provider.listScopes("netmarble", AS_OF)).rejects.toThrow(/includesScopedServices/);
  });

  it("rejects an example file marked contract_bound", async () => {
    const provider = new StaticTermsProvider([
      {
        example: true,
        partner: "scopely",
        lifecycle: "contract_bound",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        contractAggregateCap: null,
        scopes: [
          {
            kind: "catch_all",
            scopeId: "example-rest",
            includesScopedServices: true,
            target: 99.9,
            penalty: { kind: "none" },
            sourceClause: "EXAMPLE — not a contract clause",
          },
        ],
      } as unknown as HandAuthoredTermsFile,
    ]);

    await expect(provider.listScopes("scopely", AS_OF)).rejects.toThrow(/example/);
  });
});

describe("FixtureTermsProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is not imported by a route, a page, or the terms barrel", () => {
    const barrel = readFileSync(path.resolve("src/terms/index.ts"), "utf8");
    expect(barrel).not.toMatch(/FixtureTermsProvider|terms\/fixture|fixtures\/terms/);

    const roots = ["src/app", "src/feed", "src/alerts", "src/ui", "src/engine", "src/data"];
    for (const root of roots) {
      for (const file of sourceFiles(path.resolve(root))) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toMatch(/FixtureTermsProvider|terms\/fixture|fixtures\/terms/);
      }
    }
  });

  it("throws when NODE_ENV is production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");

    await expect(import("@/terms/fixture")).rejects.toThrow(/production/);
  });

  it("returns both includesScopedServices values and hides terms_pending_review", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { FixtureTermsProvider } = await import("@/terms/fixture");
    const provider = new FixtureTermsProvider();

    const scopely = await provider.listScopes("scopely", AS_OF);
    const niantic = await provider.listScopes("niantic", AS_OF);
    const kabam = await provider.listScopes("kabam", AS_OF);

    expect(scopely).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "catch_all", includesScopedServices: true }),
      ]),
    );
    expect(niantic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "catch_all", includesScopedServices: false }),
      ]),
    );
    expect(kabam).toEqual([]);

    for (const scopes of [scopely, niantic]) {
      for (const scope of scopes) {
        if (scope.kind === "catch_all") {
          expect(typeof scope.includesScopedServices).toBe("boolean");
        }
      }
    }
  });
});

type CatchAllScope = Extract<SlaScope, { kind: "catch_all" }>;
type StatedInclusion = CatchAllScope["includesScopedServices"];
const _inclusionIsRequiredBoolean: [
  StatedInclusion,
  boolean,
] extends [boolean, StatedInclusion]
  ? true
  : never = true;
void _inclusionIsRequiredBoolean;
