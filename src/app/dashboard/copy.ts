import type { BaselineComparison } from "@/feed";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Closed windows are settled. A late PIR can still move them, so they are not final. */
export const SETTLED_LABEL = "Settled";
export const OPEN_LABEL = "In progress";
export const SETTLED_NOTE = "A late PIR can still change this window.";

export const BACKTEST_TRACKING_ONLY =
  "Backtest runs once this partner's contract terms are bound. Tracking-only partners have no terms to replay.";

export const BACKTEST_NOT_ON_SCREEN = "Historical replay is not available on this screen yet.";

export const ADD_CONTRACT_TERMS = "Add contract terms";

export const VIEW_TERMS = "View terms";

export const NO_DOWNTIME = "No downtime recorded in this window.";

export const QUERY_FAILED =
  "The outage query failed. These figures are unavailable. This is not zero downtime.";

export const ROW_UNAVAILABLE = "Unavailable. This is not zero downtime.";

export const UNAVAILABLE = "Unavailable";

export const VIEWER_UNCONFIGURED =
  "Viewer role is not configured. No downtime figures were loaded.";

export const BUSINESS_VIEWER =
  "This screen is the engineer view. The current viewer is the business role, so ticket keys and review detail are not in this payload. No downtime figures are shown.";

export const HEALTH_UNAVAILABLE =
  "Outage records could not be loaded. Dropped rows, unresolved partner names, and unmatched service names are unavailable. This is not a clean extract.";

export const ZERO_COVERAGE_NOTE =
  "No resolved outage in the extract. Distinct from zero minutes in the selected window.";

export const INGESTION_FAILED_LABEL = "Failed PIRs";
export const INGESTION_UNRESOLVED_LABEL = "PIRs with unresolved values";
export const INGESTION_WITHOUT_MESSAGE_LABEL = "Captured without a Slack message";

export const INGESTION_HEALTH_UNAVAILABLE = "Ingestion health could not be loaded.";

export const INVALID_CONTRACT_TERMS_LABEL = "Invalid contract terms";

const INGESTION_DETAIL_MAX = 120;

/**
 * Truncates by Unicode code point, not UTF-16 code unit, so a surrogate
 * pair (an emoji, for example) is never split in half.
 */
export function truncate(text: string, max: number): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= max) {
    return text;
  }
  return `${codePoints.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

export function ingestionDetailText(text: string): string {
  return truncate(text, INGESTION_DETAIL_MAX);
}

export function unresolvedValuesSummary(values: readonly { kind: string; raw: string }[]): string {
  return ingestionDetailText(values.map((value) => value.raw).join("; "));
}

const REASON_LABELS = [
  ["missing_outage_minutes", "Missing outage minutes"],
  ["invalid_outage_minutes", "Invalid outage minutes"],
  ["missing_incident_started", "Missing start time"],
  ["invalid_partner_id", "Invalid merchant id"],
  ["unresolved_partner", "Unresolved partner name"],
  ["missing_affected_service", "Missing service"],
  ["unresolved_service", "Unmatched service name"],
  ["missing_severity", "Missing severity"],
  ["unresolved_severity", "Unmatched severity"],
] as const;

export function monthTitle(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (match === null) {
    return key;
  }
  const month = MONTHS[Number(match[2]) - 1];
  if (month === undefined) {
    return key;
  }
  return `${month} ${match[1]}`;
}

export function phaseLabel(phase: "open" | "settled"): string {
  return phase === "settled" ? SETTLED_LABEL : OPEN_LABEL;
}

export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return UNAVAILABLE;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) {
    return UNAVAILABLE;
  }
  const text = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(minutes);
  return `${text} min`;
}

export function comparisonText(comparison: BaselineComparison): string {
  if (comparison.kind === "insufficient_history") {
    return "Not enough history to compare yet.";
  }
  if (comparison.kind === "no_prior_downtime") {
    return `First recorded downtime in the last ${comparison.coveredMonths} covered months.`;
  }
  const median = formatMinutes(comparison.medianMinutes);
  const span = comparison.coveredMonths === 6 ? "six-month" : `${comparison.coveredMonths}-month`;
  if (comparison.versusMedian === "above") {
    return `Above this partner's ${span} median of ${median}`;
  }
  if (comparison.versusMedian === "below") {
    return `Below this partner's ${span} median of ${median}`;
  }
  return `Equal to this partner's ${span} median of ${median}`;
}

export function reviewLine(input: {
  decisionType: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}): string | null {
  const parts: string[] = [];
  if (input.decisionType !== null && input.decisionType.trim() !== "") {
    parts.push(input.decisionType.trim());
  }
  if (input.reviewedBy !== null && input.reviewedBy.trim() !== "") {
    parts.push(input.reviewedBy.trim());
  }
  if (input.reviewedAt !== null) {
    const reviewed = formatUtcTimestamp(input.reviewedAt);
    if (reviewed !== UNAVAILABLE) {
      parts.push(reviewed);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" · ");
}

export function windowMinutesLabel(totalMinutes: number, minutesInWindow: number): string {
  if (totalMinutes !== minutesInWindow) {
    return `${formatMinutes(totalMinutes)} total · ${formatMinutes(minutesInWindow)} in this window`;
  }
  return formatMinutes(minutesInWindow);
}

export function computedEnd(incidentStarted: string, totalMinutes: number): string {
  const start = new Date(incidentStarted);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(totalMinutes)) {
    return UNAVAILABLE;
  }
  return formatUtcTimestamp(new Date(start.getTime() + totalMinutes * 60_000).toISOString());
}

export function reconciliationText(outages: readonly { countedMinutes: number }[]): string {
  const counted = outages.reduce((sum, outage) => sum + outage.countedMinutes, 0);
  const noun = outages.length === 1 ? "outage" : "outages";
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(counted);
  return `${outages.length} ${noun} · ${amount} minutes counted in this window`;
}

/** Stored ticket URL, or null when it is missing or not https. */
export function ticketHref(url: string | null): string | null {
  if (url === null || url.trim() === "") {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }
  return url;
}

export function healthChip(input: {
  unusableCount: number;
  partnersWithNoRows: number;
  invalidTerms?: number;
}): { label: string; tone: "neutral" | "warning" } {
  const dropped =
    input.unusableCount === 0
      ? "No rows dropped"
      : `${input.unusableCount} ${input.unusableCount === 1 ? "row" : "rows"} dropped`;
  const coverage =
    input.partnersWithNoRows === 0
      ? null
      : `${input.partnersWithNoRows} ${input.partnersWithNoRows === 1 ? "partner" : "partners"} with no rows`;
  const invalidCount = input.invalidTerms ?? 0;
  const invalid =
    invalidCount === 0 ? null : `${invalidCount} ${invalidCount === 1 ? "invalid contract" : "invalid contracts"}`;
  const label = [dropped, coverage, invalid].filter((part) => part !== null).join(" · ");
  return {
    label,
    tone: input.unusableCount > 0 || invalidCount > 0 ? "warning" : "neutral",
  };
}

export function reasonEntries(
  counts: Readonly<Record<string, number>>,
): { key: string; label: string; count: number }[] {
  const known = new Set<string>(REASON_LABELS.map(([key]) => key));
  const listed = REASON_LABELS.flatMap(([key, label]) => {
    const count = counts[key] ?? 0;
    return count > 0 ? [{ key, label, count }] : [];
  });
  const extras = Object.entries(counts).flatMap(([key, count]) => {
    if (known.has(key) || !(count > 0)) {
      return [];
    }
    return [{ key, label: key, count }];
  });
  return [...listed, ...extras];
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS.find(([key]) => key === reason)?.[1] ?? reason;
}
