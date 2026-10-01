import {
  getDatabase,
  loadIngestionHealth,
  loadOutages,
  readContractTerms,
  type IngestionHealth,
  type OutagePartition,
} from "@/data";
import { DbTermsProvider, type InvalidContractTerms, type SlaTermsProvider } from "@/terms";
import type { FeedSources } from "./types";

export async function readPartition(sources?: FeedSources): Promise<OutagePartition> {
  if (sources?.partition !== undefined) {
    return sources.partition;
  }
  return loadOutages(getDatabase());
}

/** Production reads sla_contract_terms. Tests pass sources.terms. */
export function readTerms(sources?: FeedSources): SlaTermsProvider {
  if (sources?.terms !== undefined) {
    return sources.terms;
  }
  return new DbTermsProvider(() => readContractTerms(getDatabase()));
}

/**
 * Rows `loadContractFile` rejected. Stand-in providers used in tests have
 * none. Call after listScopes, or this loads the table itself.
 */
export async function readInvalidTerms(terms: SlaTermsProvider): Promise<InvalidContractTerms[]> {
  if (!(terms instanceof DbTermsProvider)) {
    return [];
  }
  await terms.load();
  return terms.invalidTerms;
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
