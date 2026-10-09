import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { partitionOutages, readContractTerms, saveContractTerms, type IngestionHealth, type OutageSourceRow } from "@/data";
import { getSlaFeed } from "@/feed";
import { DbTermsProvider, loadContractFile, type ContractFile, type ContractScope } from "@/terms";
import { INVALID_CONTRACT_TERMS_LABEL } from "@/app/dashboard/copy";
import { HealthPage } from "@/app/dashboard/health-page";
import { buildHealth } from "@/app/dashboard/model";
import { createTestDatabase, type TestDatabase } from "../support/database";

const AS_OF = new Date("2026-06-15T12:00:00.000Z");
const WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-07-01T00:00:00.000Z"),
};

function scope(overrides: Partial<ContractScope> = {}): ContractScope {
  return {
    kind: "service",
    scopeId: "payments",
    services: ["payments"],
    target: 99.95,
    penalty: { kind: "none" },
    sourceClause: "FIXTURE — not a contract clause",
    ...overrides,
  };
}

function body(overrides: Partial<Pick<ContractFile, "effectiveFrom" | "effectiveTo" | "scopes" | "contractAggregateCap">> = {}) {
  return {
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [scope()],
    ...overrides,
  };
}

function outage(overrides: Partial<OutageSourceRow>): OutageSourceRow {
  return {
    id: 1,
    pirKey: "GTO-1",
    partner: "Roblox",
    partnerId: "38519",
    incidentStarted: new Date("2026-06-10T12:00:00.000Z"),
    affectedService: "Payments",
    outageMinutes: "10",
    severity: "L1",
    source: "pipeline",
    reviewedBy: null,
    decisionType: "system_written",
    reviewedAt: null,
    pirUrl: null,
    ...overrides,
  };
}

function ingestion(): IngestionHealth {
  return {
    failed: { items: [], totalCount: 0 },
    unresolved: { items: [], totalCount: 0 },
    withoutMessage: { items: [], totalCount: 0 },
  };
}

describe("DbTermsProvider", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("returns contract_bound scopes and ignores terms_pending_review rows", async () => {
    testDb = await createTestDatabase();
    const bound = body({ scopes: [scope({ scopeId: "roblox-payments" })] });
    await saveContractTerms(testDb.db, "roblox", bound, "contract_bound", "ada", null);
    await saveContractTerms(
      testDb.db,
      "twitch",
      body({ scopes: [scope({ scopeId: "twitch-login", services: ["login"] })] }),
      "terms_pending_review",
      "ada",
      null,
    );

    const provider = new DbTermsProvider(() => readContractTerms(testDb.db));

    expect(await provider.listScopes("roblox", AS_OF)).toEqual(
      loadContractFile({ partner: "roblox", lifecycle: "contract_bound", ...bound }).scopes,
    );
    expect(await provider.listScopes("twitch", AS_OF)).toEqual([]);
    expect(provider.invalidTerms).toEqual([]);
  });

  it("reports one invalid row on the health panel and still scores the other partner", async () => {
    testDb = await createTestDatabase();
    const bound = body({ scopes: [scope({ scopeId: "roblox-payments" })] });
    await saveContractTerms(testDb.db, "roblox", bound, "contract_bound", "ada", null);
    await testDb.client.query(
      `insert into sla_contract_terms (partner_slug, lifecycle, terms, version, updated_by, updated_at, created_at)
       values ('twitch', 'contract_bound', $1::jsonb, 1, 'ada', now(), now())`,
      [
        JSON.stringify({
          partner: "twitch",
          lifecycle: "contract_bound",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          contractAggregateCap: null,
          scopes: [scope({ scopeId: "twitch-payments", target: 200 })],
        }),
      ],
    );

    const provider = new DbTermsProvider(() => readContractTerms(testDb.db));
    const feed = await getSlaFeed({
      asOf: AS_OF,
      window: WINDOW,
      viewer: { role: "technical" },
      sources: {
        terms: provider,
        partition: partitionOutages([
          outage({ id: 1, pirKey: "GTO-1", partner: "Roblox", partnerId: "38519" }),
          outage({ id: 2, pirKey: "GTO-2", partner: "Twitch", partnerId: "13132" }),
        ]),
        ingestion: ingestion(),
      },
    });

    expect(feed.role).toBe("technical");
    if (feed.role !== "technical") {
      return;
    }
    const roblox = feed.rows.filter((row) => row.partner === "roblox");
    const twitch = feed.rows.filter((row) => row.partner === "twitch");
    expect(roblox.length).toBeGreaterThan(0);
    expect(roblox.every((row) => row.kind === "scored")).toBe(true);
    expect(twitch.length).toBeGreaterThan(0);
    expect(twitch.every((row) => row.kind === "tracking_only")).toBe(true);
    expect(feed.invalidTerms).toEqual([
      expect.objectContaining({
        partner: "twitch",
        message: expect.stringMatching(/0 to 100/),
      }),
    ]);

    const html = renderToStaticMarkup(
      <HealthPage
        health={buildHealth({ health: feed.health, ingestion: feed.ingestion, invalidTerms: feed.invalidTerms })}
        unusable={[]}
      />,
    );
    expect(html).toContain(INVALID_CONTRACT_TERMS_LABEL);
    expect(html).toContain("Twitch");
    expect(html).toContain("0 to 100");
  });
});
