import { afterEach, describe, expect, it } from "vitest";
import { partitionOutages, type IngestionHealth } from "@/data";
import { getSlaFeed, getSlaHealth } from "@/feed";
import { FixtureTermsProvider } from "@/terms/fixture";

const PIR_KEY = "GTO-9999";

const asOf = new Date("2026-04-20T00:00:00.000Z");
const window = {
  start: new Date("2026-04-01T00:00:00.000Z"),
  end: new Date("2026-05-01T00:00:00.000Z"),
};

function ingestionStandIn(): IngestionHealth {
  return {
    failed: {
      items: [
        {
          pirKey: PIR_KEY,
          pirUrl: `https://jira.example/browse/${PIR_KEY}`,
          error: "Jira fetch failed",
          updatedAt: new Date("2026-04-18T00:00:00.000Z"),
        },
      ],
      totalCount: 1,
    },
    unresolved: {
      items: [
        {
          pirKey: PIR_KEY,
          pirUrl: `https://jira.example/browse/${PIR_KEY}`,
          values: [{ kind: "merchant", raw: "Some Studio LLC" }],
        },
      ],
      totalCount: 1,
    },
    withoutMessage: {
      items: [
        {
          pirKey: PIR_KEY,
          pirUrl: `https://jira.example/browse/${PIR_KEY}`,
          slackError: "channel_not_found",
        },
      ],
      totalCount: 1,
    },
  };
}

describe("ingestion health in the feed", () => {
  it("carries the full lists for the technical and system roles", async () => {
    const sources = { partition: partitionOutages([]), terms: new FixtureTermsProvider(), ingestion: ingestionStandIn() };

    for (const role of ["technical", "system"] as const) {
      const feed = await getSlaFeed({ asOf, window, viewer: { role }, sources });
      expect(feed.ingestion).toEqual({
        status: "ok",
        counts: { failed: 1, unresolved: 1, withoutMessage: 1 },
        failed: [
          {
            pirKey: PIR_KEY,
            pirUrl: `https://jira.example/browse/${PIR_KEY}`,
            error: "Jira fetch failed",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
        unresolved: [
          {
            pirKey: PIR_KEY,
            pirUrl: `https://jira.example/browse/${PIR_KEY}`,
            values: [{ kind: "merchant", raw: "Some Studio LLC" }],
          },
        ],
        withoutMessage: [
          { pirKey: PIR_KEY, pirUrl: `https://jira.example/browse/${PIR_KEY}`, slackError: "channel_not_found" },
        ],
      });

      const health = await getSlaHealth({ asOf, viewer: { role }, sources });
      expect(health.ingestion).toMatchObject({ status: "ok", counts: { failed: 1, unresolved: 1, withoutMessage: 1 } });
    }
  });

  it("gives the business role counts only, with no PIR key, URL, error text or raw values", async () => {
    const sources = { partition: partitionOutages([]), terms: new FixtureTermsProvider(), ingestion: ingestionStandIn() };

    const feed = await getSlaFeed({ asOf, window, viewer: { role: "business" }, sources });
    expect(feed.ingestion).toEqual({ status: "ok", counts: { failed: 1, unresolved: 1, withoutMessage: 1 } });
    expect(JSON.stringify(feed.ingestion)).not.toContain(PIR_KEY);
    expect(JSON.stringify(feed.ingestion)).not.toContain("Some Studio LLC");
    expect(JSON.stringify(feed.ingestion)).not.toContain("channel_not_found");
    expect(JSON.stringify(feed.ingestion)).not.toContain("Jira fetch failed");

    const health = await getSlaHealth({ asOf, viewer: { role: "business" }, sources });
    expect(health.ingestion).toEqual({ status: "ok", counts: { failed: 1, unresolved: 1, withoutMessage: 1 } });
  });

  describe("when loading ingestion health throws", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;

    afterEach(() => {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    });

    it("does not fail the feed; it carries ingestion: { status: 'error' } and keeps the rest of the feed", async () => {
      delete process.env.DATABASE_URL;
      const sources = { partition: partitionOutages([]), terms: new FixtureTermsProvider() };

      const feed = await getSlaFeed({ asOf, window, viewer: { role: "technical" }, sources });
      expect(feed.ingestion).toEqual({ status: "error" });
      expect(feed.role).toBe("technical");
      expect(Array.isArray(feed.rows)).toBe(true);

      const health = await getSlaHealth({ asOf, viewer: { role: "technical" }, sources });
      expect(health.ingestion).toEqual({ status: "error" });
    });

    it("carries the error status for the business role too, without ever showing a zero", async () => {
      delete process.env.DATABASE_URL;
      const sources = { partition: partitionOutages([]), terms: new FixtureTermsProvider() };

      const feed = await getSlaFeed({ asOf, window, viewer: { role: "business" }, sources });
      expect(feed.ingestion).toEqual({ status: "error" });
    });
  });
});
