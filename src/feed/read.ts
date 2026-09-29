import { getDatabase, loadIngestionHealth, loadOutages, type IngestionHealth, type OutagePartition } from "@/data";
import { EmptyTermsProvider, type SlaTermsProvider } from "@/terms";
import type { FeedSources } from "./types";

export async function readPartition(sources?: FeedSources): Promise<OutagePartition> {
  if (sources?.partition !== undefined) {
    return sources.partition;
  }
  return loadOutages(getDatabase());
}

/** Empty until a reviewed contract file replaces this one line. */
export function readTerms(sources?: FeedSources): SlaTermsProvider {
  return sources?.terms ?? new EmptyTermsProvider();
}

export type IngestionHealthResult = { status: "ok"; health: IngestionHealth } | { status: "error" };

/**
 * Failure isolation (design §2, §4; main spec §9.3): if loading ingestion
 * health throws, the feed does not fail. This reader catches it here so
 * getSlaFeed and getSlaHealth always have a defined `ingestion` value,
 * carrying `{ status: "error" }` instead of a zero that would look clean.
 */
export async function readIngestionHealth(sources?: FeedSources): Promise<IngestionHealthResult> {
  if (sources?.ingestion !== undefined) {
    return { status: "ok", health: sources.ingestion };
  }
  try {
    return { status: "ok", health: await loadIngestionHealth(getDatabase()) };
  } catch (error) {
    console.error("[sla-feed] ingestion health", error);
    return { status: "error" };
  }
}
