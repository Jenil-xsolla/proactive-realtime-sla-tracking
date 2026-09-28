import type { IngestionHealth } from "@/data";
import type { IngestionHealthResult } from "./read";
import type { IngestionCounts, IngestionHealthCounts, IngestionHealthDetail } from "./types";

function toCounts(health: IngestionHealth): IngestionCounts {
  return {
    failed: health.failed.totalCount,
    unresolved: health.unresolved.totalCount,
    withoutMessage: health.withoutMessage.totalCount,
  };
}

/** Business role: counts only, no PIR key, URL, error text or raw values (main spec §8.2). */
export function toIngestionCounts(result: IngestionHealthResult): IngestionHealthCounts {
  if (result.status === "error") {
    return { status: "error" };
  }
  return { status: "ok", counts: toCounts(result.health) };
}

/** Technical and system roles: the full lists with keys and URLs. */
export function toIngestionDetail(result: IngestionHealthResult): IngestionHealthDetail {
  if (result.status === "error") {
    return { status: "error" };
  }
  const { health } = result;
  return {
    status: "ok",
    counts: toCounts(health),
    failed: health.failed.items.map((row) => ({
      pirKey: row.pirKey,
      pirUrl: row.pirUrl,
      error: row.error,
      updatedAt: row.updatedAt.toISOString(),
    })),
    unresolved: health.unresolved.items.map((row) => ({
      pirKey: row.pirKey,
      pirUrl: row.pirUrl,
      values: row.values,
    })),
    withoutMessage: health.withoutMessage.items.map((row) => ({
      pirKey: row.pirKey,
      pirUrl: row.pirUrl,
      slackError: row.slackError,
    })),
  };
}
