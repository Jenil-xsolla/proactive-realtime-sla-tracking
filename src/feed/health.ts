import { summarizeOutageHealth } from "@/data";
import { toIngestionCounts, toIngestionDetail } from "./ingestion";
import { readIngestionHealth, readInvalidTerms, readPartition, readTerms } from "./read";
import type { FeedSources, SlaHealth, UnusableRow } from "./types";
import type { Viewer } from "./viewer";

/** Same outage read as the feed. Business callers receive the summary only. */
export async function getSlaHealth(input: {
  asOf: Date;
  viewer: Viewer;
  sources?: FeedSources;
}): Promise<SlaHealth> {
  const partition = await readPartition(input.sources);
  const health = summarizeOutageHealth(partition);
  const ingestionResult = await readIngestionHealth(input.sources);
  const invalidTerms = await readInvalidTerms(readTerms(input.sources));
  const asOf = input.asOf.toISOString();

  if (input.viewer.role === "business") {
    return { asOf, role: "business", health, ingestion: toIngestionCounts(ingestionResult) };
  }

  const unusable: UnusableRow[] = partition.unusable.map((row) => ({
    pirKey: row.pirKey,
    partner: row.partner,
    partnerId: row.merchantId,
    affectedService: row.affectedService,
    incidentStarted: row.incidentStarted === null ? null : row.incidentStarted.toISOString(),
    rawOutageMinutes: row.rawOutageMinutes,
    reasons: row.reasons,
  }));

  return {
    asOf,
    role: input.viewer.role,
    health,
    unusable,
    ingestion: toIngestionDetail(ingestionResult),
    invalidTerms,
  };
}
