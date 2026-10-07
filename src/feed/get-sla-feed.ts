import { summarizeOutageHealth } from "@/data";
import { evaluate, type PartnerScopes, type Window } from "@/engine";
import { PARTNERS, type PartnerId } from "@/registry";
import type { SlaScope } from "@/terms";
import { toBusinessView } from "./business";
import { toIngestionCounts, toIngestionDetail } from "./ingestion";
import { readIngestionHealth, readInvalidTerms, readPartition, readTerms } from "./read";
import { toTechnicalView } from "./technical";
import type { FeedSources, SlaFeed } from "./types";
import type { Viewer } from "./viewer";

/**
 * The only composition of outages, registry identity, terms, and evaluate().
 * Dashboards and alerts both call this, then receive the shape for their role.
 */
export async function getSlaFeed(input: {
  asOf: Date;
  window: Window;
  viewer: Viewer;
  sources?: FeedSources;
}): Promise<SlaFeed> {
  const partition = await readPartition(input.sources);
  const terms = readTerms(input.sources);
  const scopes = await scopesFor(terms, input.asOf);
  const invalidTerms = await readInvalidTerms(terms);
  const evaluations = evaluate({
    outages: partition.usable,
    scopes,
    window: input.window,
    asOf: input.asOf,
  });
  const health = summarizeOutageHealth(partition);
  const ingestionResult = await readIngestionHealth(input.sources);
  const asOf = input.asOf.toISOString();

  if (input.viewer.role === "business") {
    return {
      asOf,
      health,
      role: "business",
      rows: toBusinessView(evaluations, scopes),
      ingestion: toIngestionCounts(ingestionResult),
    };
  }

  // The alert job uses the system role and reads this same engineer payload.
  return {
    asOf,
    health,
    role: input.viewer.role,
    rows: toTechnicalView(evaluations, partition.usable, scopes),
    ingestion: toIngestionDetail(ingestionResult),
    invalidTerms,
  };
}

async function scopesFor(
  terms: { listScopes(partner: PartnerId, asOf: Date): Promise<SlaScope[]> },
  asOf: Date,
): Promise<PartnerScopes[]> {
  return Promise.all(
    PARTNERS.map(async (partner) => ({
      partner: partner.id,
      scopes: await terms.listScopes(partner.id, asOf),
    })),
  );
}
