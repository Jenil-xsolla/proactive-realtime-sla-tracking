import { partitionOutages, type IngestionHealth, type OutageSourceRow } from "@/data";
import { getSlaFeed } from "@/feed";
import { FixtureTermsProvider } from "@/terms/fixture";

export const PIR_KEY = "GTO-543";
export const TRACKING_PIR_KEY = "GTO-544";
export const INGESTION_PIR_KEY = "GTO-9999";

export const AS_OF = new Date("2026-04-20T00:00:00.000Z");
export const WINDOW = {
  start: new Date("2026-04-01T00:00:00.000Z"),
  end: new Date("2026-05-01T00:00:00.000Z"),
};
export const WINDOW_KEY = "2026-04";

export function ingestionHealth(): IngestionHealth {
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

/** Scopely has fixture terms, so this outage scores. */
export function scoredOutage(): OutageSourceRow {
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

/** Bandai Namco has no fixture terms, so this outage is tracking only. */
export function trackingOutage(): OutageSourceRow {
  return {
    ...scoredOutage(),
    id: 2,
    pirKey: TRACKING_PIR_KEY,
    partner: "Bandai Namco",
    partnerId: "503608",
    incidentStarted: new Date("2026-04-14T09:00:00.000Z"),
    outageMinutes: "6",
    pirUrl: `https://jira.example/browse/${TRACKING_PIR_KEY}`,
  };
}

export function businessFeedSources(outages: readonly OutageSourceRow[] = [scoredOutage()]) {
  return {
    partition: partitionOutages([...outages]),
    terms: new FixtureTermsProvider(),
    ingestion: ingestionHealth(),
  };
}

/** A real business evaluation of the fixture outages, so assertions on its markup are not hand-built. */
export async function evaluateBusinessFeed(outages: readonly OutageSourceRow[] = [scoredOutage()]) {
  return getSlaFeed({
    asOf: AS_OF,
    window: WINDOW,
    viewer: { role: "business" },
    sources: businessFeedSources(outages),
  });
}
