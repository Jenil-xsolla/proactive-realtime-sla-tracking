import type { BaselineComparison, PenaltyFigure, StatusReason } from "@/feed";

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

export const BACKTEST_FAILED =
  "Historical replay could not be loaded. This is not a result of zero breaches.";

export const BACKTEST_NO_EXPOSURE = "No exposure";

export const BACKTEST_COUNT_NOTE =
  "Trend and level each count on a step where that clause fired. Breaching and meeting each count alone.";

export const CLAUSE_NOT_RECORDED = "Clause not recorded";

export const FILED_AGAINST = "Filed against";

export const SLA_SECTION = "SLA";

export const TRACKING_ONLY_SECTION = "Tracking only";

export function affectedServicesLine(services: readonly string[]): string {
  return `Affected: ${services.join(", ")}`;
}

export const EXHAUSTION_NONE = "None projected";

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

export function formatMinuteValue(minutes: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(minutes);
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) {
    return UNAVAILABLE;
  }
  return `${formatMinuteValue(minutes)} min`;
}

/** A fraction rendered as a percent. 0.1 is 10%. 0 is 0%. */
export function formatPercent(fraction: number): string {
  const percent = Math.round(fraction * 10_000) / 100;
  const text = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(percent);
  return `${text}%`;
}

export function formatTarget(fraction: number): string {
  return formatPercent(fraction);
}

export function statusLabel(status: "meeting" | "at_risk" | "breaching"): string {
  if (status === "at_risk") {
    return "At risk";
  }
  if (status === "breaching") {
    return "Breaching";
  }
  return "Meeting";
}

/**
 * Sentence built from the rule and the inputs on `reason`.
 * Components render this string; they do not compose status prose themselves.
 */
export function statusExplanation(reason: StatusReason): string {
  const used = formatMinutes(reason.usedMinutes);
  const allowed = formatMinutes(reason.allowedMinutes);
  if (reason.rule === "breaching") {
    return `Downtime has used ${used} of the ${allowed} allowance for this window.`;
  }
  const consumed =
    reason.consumedFraction === null ? "an undefined share" : formatPercent(reason.consumedFraction);
  const projected = formatMinutes(reason.projectedMinutes);
  if (reason.rule === "trend" && reason.fired.includes("level")) {
    return `Most of the allowance is already used (${consumed}), and the current pace would exhaust it before the window closes. Projected downtime is ${projected}.`;
  }
  if (reason.rule === "trend") {
    return `At the current pace, downtime will exhaust the allowance before the window closes. Projected downtime is ${projected} against ${allowed} allowed.`;
  }
  if (reason.rule === "level") {
    return `Most of the downtime allowance is already used (${consumed} of ${allowed}).`;
  }
  return `Downtime is within the allowance at this point in the window. ${used} of ${allowed} used.`;
}

export function penaltyText(figure: PenaltyFigure): string {
  if (figure.kind === "none" || figure.kind === "unknown") {
    return figure.statement;
  }
  const percent = formatPercent(figure.creditFraction);
  if (figure.amount === null) {
    return percent;
  }
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(figure.amount.amount);
  return `${percent} · ${amount} ${figure.amount.currency}`;
}

export function tierDistanceText(usedMinutes: number, startsAfterMinutes: number): string {
  const used = formatMinuteValue(usedMinutes);
  const next = formatMinuteValue(startsAfterMinutes);
  return `${used} of ${next} min used; the next tier starts after ${next} min`;
}

/** Null when the scored window opens on the first UTC midnight of the month. */
export function proratedWindowNote(windowStartIso: string): string | null {
  const date = new Date(windowStartIso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const midnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (date.getUTCDate() === 1 && midnight) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `Starts ${year}-${month}-${day}. Allowance is prorated to this shorter window.`;
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

export const NO_SERVICE = "No service";
export const NO_TERMS = "No terms";
export const TO_DATE = "to date";
export const TRACKING_ONLY_LABEL = "Tracking only";
export const TRACKING_ONLY_NOTE =
  "Tracking only. Minutes are recorded downtime; there is no target or status.";
export const NO_TARGET_NOTE = "No target, no status";
export const NO_ATTENTION = "No term is at risk or breaching in this window.";
export const NO_TICKETS = "No outages in this window.";
export const DRAFT_TERMS = "Draft terms, not scoring";
export const CONTRACT_ON_FILE = "Contract on file";
export const MONTHLY_WINDOW = "Monthly window";
export const OUTSIDE_SCOPES = "Outside contracted scopes";
export const UPTIME_CAPTION = "UPTIME · MONTHLY";
export const ALERTS_NOTE =
  "Transitions only. The job writes a row when a status rises and sends; recoveries are recorded without a message.";
export const ALERTS_UNAVAILABLE = "Alert history unavailable.";
export const HEALTH_UNAVAILABLE_CHIP = "Health unavailable";
export const NEVER_ALERTED = "Never";
export const TREND_NA = "n/a";

/** Uptime with three decimals, as contracts write it. 0.9995 is 99.950%. */
export function formatUptime(fraction: number): string {
  return `${(Math.round(fraction * 100_000) / 1000).toFixed(3)}%`;
}

/**
 * Display derivation only. Over the elapsed window while open, over the full
 * window once settled. With nothing elapsed there is no downtime to divide by,
 * so uptime is 1.
 */
export function actualUptime(input: {
  usedMinutes: number;
  windowMinutes: number;
  elapsedMinutes: number;
  phase: "open" | "settled";
}): number {
  const denominator = input.phase === "settled" ? input.windowMinutes : input.elapsedMinutes;
  if (!(denominator > 0)) {
    return 1;
  }
  return Math.max(0, 1 - input.usedMinutes / denominator);
}

export function consumedText(usedMinutes: number, allowedMinutes: number): string {
  if (!(allowedMinutes > 0)) {
    return "Allowance is zero";
  }
  const percent = Math.round((usedMinutes / allowedMinutes) * 1000) / 10;
  return `${percent.toFixed(1)}% consumed`;
}

export function downLine(usedMinutes: number, allowedMinutes: number): string {
  return `${usedMinutes.toFixed(1)} / ${allowedMinutes.toFixed(1)} min down`;
}

export function creditText(incurred: string, projected: string): string {
  return `${incurred} → ${projected}`;
}

export function trendText(
  versusMedian: "above" | "equal" | "below" | null,
): { mark: "up" | "down" | "flat" | "none"; text: string } {
  if (versusMedian === "above") return { mark: "up", text: "above median" };
  if (versusMedian === "below") return { mark: "down", text: "below median" };
  if (versusMedian === "equal") return { mark: "flat", text: "at median" };
  return { mark: "none", text: TREND_NA };
}

export function summaryLine(terms: number, partners: number, trackingOnly: number): string {
  const head = `Monitoring ${terms} SLA ${terms === 1 ? "term" : "terms"} across ${partners} ${partners === 1 ? "partner" : "partners"}`;
  if (trackingOnly === 0) {
    return `${head}.`;
  }
  return `${head} · ${trackingOnly} ${trackingOnly === 1 ? "partner" : "partners"} tracking only.`;
}

export function railLine(input: {
  terms: number;
  outages: number;
  minutes: number;
  trackingOnly: boolean;
  services?: number;
}): string {
  const outages = `${input.outages} ${input.outages === 1 ? "outage" : "outages"}`;
  if (input.trackingOnly) {
    const services = input.services ?? 0;
    return `${services} ${services === 1 ? "service" : "services"} · ${outages} · ${input.minutes.toFixed(1)} min recorded`;
  }
  return `${input.terms} ${input.terms === 1 ? "term" : "terms"} · ${outages} · ${input.minutes.toFixed(1)} min`;
}

export function alertScopeLabel(scopeId: string, title: (scopeId: string) => string): string {
  const prefix = "tracking:";
  if (scopeId.startsWith(prefix)) {
    return `Service: ${title(scopeId.slice(prefix.length))}`;
  }
  return title(scopeId);
}

export function alertStatusLabel(status: string): string {
  if (status === "heads_up") return "Heads-up";
  if (status === "quiet") return "Quiet";
  if (status === "meeting" || status === "at_risk" || status === "breaching")
    return statusLabel(status);
  return status;
}

export function noAlertsFor(monthTitle: string): string {
  return `No alerts recorded for ${monthTitle}.`;
}
