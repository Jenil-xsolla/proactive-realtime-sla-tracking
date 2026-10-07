import { describe, expect, it } from "vitest";
import { partitionOutages, type IngestionHealth, type OutageSourceRow } from "@/data";
import { getSlaFeed, getSlaHealth } from "@/feed";
import { FixtureTermsProvider } from "@/terms/fixture";

const PIR_KEY = "GTO-543";
const INGESTION_PIR_KEY = "GTO-9999";

function ingestionHealth(): IngestionHealth {
  return {
    failed: {
      items: [
        {
          pirKey: INGESTION_PIR_KEY,
          pirUrl: `https://jira.example/browse/${INGESTION_PIR_KEY}`,
          error: "Jira fetch failed",
          updatedAt: new Date("2026-04-18T00:00:00.000Z"),
        },
      ],
      totalCount: 1,
    },
    unresolved: { items: [], totalCount: 0 },
    withoutMessage: { items: [], totalCount: 0 },
  };
}

function scoredOutage(): OutageSourceRow {
  return {
    id: 1,
    pirKey: PIR_KEY,
    partner: "Scopely",
    partnerId: "151639",
    incidentStarted: new Date("2026-04-16T12:00:00.000Z"),
    affectedService: "Payments",
    outageMinutes: "10",
    severity: "L1 — Critical",
    source: "pipeline",
    reviewedBy: "ada",
    decisionType: "ai_approved",
    reviewedAt: new Date("2026-04-16T13:00:00.000Z"),
    pirUrl: `https://jira.example/browse/${PIR_KEY}`,
  };
}

describe("business feed payload", () => {
  it("contains no PIR key anywhere in its serialised form for a scored fixture scope", async () => {
    const sources = {
      partition: partitionOutages([scoredOutage()]),
      terms: new FixtureTermsProvider(),
      ingestion: ingestionHealth(),
    };
    const asOf = new Date("2026-04-20T00:00:00.000Z");
    const window = {
      start: new Date("2026-04-01T00:00:00.000Z"),
      end: new Date("2026-05-01T00:00:00.000Z"),
    };
    const technical = JSON.stringify(
      await getSlaFeed({ asOf, window, viewer: { role: "technical" }, sources }),
    );
    const business = JSON.stringify(
      await getSlaFeed({ asOf, window, viewer: { role: "business" }, sources }),
    );

    expect(technical).toContain(PIR_KEY);
    expect(technical).toContain(INGESTION_PIR_KEY);
    expect(technical).toContain("FIXTURE — not a contract clause");
    expect(technical).toContain('"windowStart"');
    expect(business).not.toContain("FIXTURE — not a contract clause");
    expect(business).toContain('"kind":"scored"');
    expect(business).not.toContain(PIR_KEY);
    expect(business).not.toContain("151639");
    expect(business).not.toContain("ada");
    expect(business).not.toContain("ai_approved");
    expect(business).not.toContain("L1");
    expect(business).not.toContain(INGESTION_PIR_KEY);
  });

  it("keeps the ingestion PIR key out of the business health payload too", async () => {
    const sources = {
      partition: partitionOutages([scoredOutage()]),
      terms: new FixtureTermsProvider(),
      ingestion: ingestionHealth(),
    };
    const asOf = new Date("2026-04-20T00:00:00.000Z");

    const technicalHealth = JSON.stringify(
      await getSlaHealth({ asOf, viewer: { role: "technical" }, sources }),
    );
    const businessHealth = JSON.stringify(
      await getSlaHealth({ asOf, viewer: { role: "business" }, sources }),
    );

    expect(technicalHealth).toContain(INGESTION_PIR_KEY);
    expect(businessHealth).not.toContain(INGESTION_PIR_KEY);
    expect(businessHealth).not.toContain("Jira fetch failed");
  });
});
