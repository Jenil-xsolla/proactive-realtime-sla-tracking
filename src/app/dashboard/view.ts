import { listPilotPartners, partnerLabel, partnerMerchantIds, scopeTitle, serviceLabel } from "@/feed";
import type { BusinessCredit, BusinessRow, MonthHistory, TechnicalRow } from "@/feed";
import {
  CLAUSE_NOT_RECORDED,
  EXHAUSTION_NONE,
  TO_DATE,
  actualUptime,
  comparisonText,
  consumedText,
  creditText,
  downLine,
  formatMinutes,
  formatPercent,
  formatUptime,
  formatUtcTimestamp,
  monthTitle,
  penaltyText,
  proratedWindowNote,
  reconciliationText,
  statusExplanation,
  tierDistanceText,
  trendText,
} from "./copy";
import { toOutageViews, type OutageView } from "./outage-view";

export type Status = "meeting" | "at_risk" | "breaching";
export type TrendBar = { month: string; label: string; minutes: number | null; current: boolean };
export type TrendView = { bars: TrendBar[]; mark: "up" | "down" | "flat" | "none"; text: string; summary: string };
export type TicketView = { key: string; href: string | null };

export type TermView = {
  key: string;
  title: string;
  status: Status;
  target: string;
  actual: string;
  actualCaption: string | null;
  allowed: string;
  consumed: string;
  remaining: string;
  usedMinutes: number;
  allowedMinutes: number;
  consumedPercent: string;
  downLine: string;
  trend: TrendView;
  exhaustion: string;
  credit: { incurred: string; projected: string; text: string };
  sentence: string;
  nextTier: string | null;
  windowNote: string | null;
  /** Technical role only; null for business. */
  clause: { text: string; missing: boolean } | null;
  /** Technical role only; null for business. Empty when the term had no outages. */
  tickets: TicketView[] | null;
  /** Technical role only; null means the row does not expand. */
  outages: OutageView[] | null;
  reconciliation: string;
};
export type TrackingView = {
  key: string;
  service: string;
  minutes: string;
  incidents: string;
  usedMinutes: number;
  outageCount: number;
  comparison: string;
  trend: TrendView;
  outages: OutageView[] | null;
  reconciliation: string;
};
export type ContractTermsState = "add" | "view" | "draft" | "unknown";
export type PartnerView = {
  id: string;
  name: string;
  /** Technical role only; null for business. */
  merchantIds: string[] | null;
  terms: TermView[];
  tracking: TrackingView[];
  /** Null when the partner has no scored term. */
  worst: Status | null;
  trackingOnly: boolean;
  /** True when the feed failed; pages render error rows, never zeros. */
  unavailable: boolean;
  /** Null for business. */
  contractTerms: ContractTermsState | null;
  backtestEnabled: boolean;
};
export type TermsIndex = {
  withTerms: ReadonlySet<string>;
  bound: ReadonlySet<string>;
  draft: ReadonlySet<string>;
} | null;

const RANK: Record<Status, number> = { meeting: 0, at_risk: 1, breaching: 2 };

export function worstStatus(statuses: readonly Status[]): Status | null {
  let worst: Status | null = null;
  for (const status of statuses) {
    if (worst === null || RANK[status] > RANK[worst]) worst = status;
  }
  return worst;
}

export function buildTrend(
  history: readonly MonthHistory[],
  windowKey: string,
  usedMinutes: number,
  versusMedian: "above" | "equal" | "below" | null,
): TrendView {
  const bars: TrendBar[] = history.map((entry) => ({
    month: entry.month,
    label: monthTitle(entry.month),
    minutes: entry.usedMinutes,
    current: false,
  }));
  bars.push({ month: windowKey, label: monthTitle(windowKey), minutes: usedMinutes, current: true });
  const text = trendText(versusMedian);
  const summary = bars
    .map((bar) => `${bar.label}: ${bar.minutes === null ? "no data" : `${bar.minutes.toFixed(1)} min`}`)
    .join("; ");
  return { bars, mark: text.mark, text: text.text, summary };
}

function contractTermsState(id: string, index: TermsIndex): ContractTermsState {
  if (index === null) return "unknown";
  if (index.bound.has(id)) return "view";
  if (index.draft.has(id)) return "draft";
  return index.withTerms.has(id) ? "view" : "add";
}

function uptimeFields(input: {
  usedMinutes: number;
  windowMinutes: number;
  elapsedMinutes: number;
  phase: "open" | "settled";
}) {
  return {
    actual: formatUptime(actualUptime(input)),
    actualCaption: input.phase === "open" ? TO_DATE : null,
  };
}

/** A statement the feed repeats for both figures reads once; numeric pairs keep the arrow. */
function creditSummary(incurred: string, projected: string, numeric: boolean): string {
  return !numeric && incurred === projected ? incurred : creditText(incurred, projected);
}

/** One ticket per PIR: a multi-service scope has one outage row per service for the same PIR. Order and first href are kept. */
function uniqueTickets(outages: readonly OutageView[]): TicketView[] {
  const seen = new Set<string>();
  const tickets: TicketView[] = [];
  for (const outage of outages) {
    if (seen.has(outage.pirKey)) continue;
    seen.add(outage.pirKey);
    tickets.push({ key: outage.pirKey, href: outage.href });
  }
  return tickets;
}

function technicalTerm(
  row: Extract<TechnicalRow, { kind: "scored" }>,
  phase: "open" | "settled",
  windowKey: string,
): TermView {
  const outages = toOutageViews(row.outages);
  const clause = row.sourceClause.trim();
  const incurred = penaltyText(row.penalty.incurred);
  const projected = penaltyText(row.penalty.projected);
  return {
    key: `${row.partner}:${row.scopeId}`,
    title: scopeTitle(row),
    status: row.status,
    target: formatUptime(row.target),
    ...uptimeFields({
      usedMinutes: row.usedMinutes,
      windowMinutes: row.windowMinutes,
      elapsedMinutes: row.elapsedMinutes,
      phase,
    }),
    allowed: formatMinutes(row.allowedMinutes),
    consumed: formatMinutes(row.usedMinutes),
    remaining: formatMinutes(row.remainingMinutes),
    usedMinutes: row.usedMinutes,
    allowedMinutes: row.allowedMinutes,
    consumedPercent: consumedText(row.usedMinutes, row.allowedMinutes),
    downLine: downLine(row.usedMinutes, row.allowedMinutes),
    trend: buildTrend(
      row.history,
      windowKey,
      row.usedMinutes,
      row.comparison.kind === "compared" ? row.comparison.versusMedian : null,
    ),
    exhaustion: row.projectedExhaustion === null ? EXHAUSTION_NONE : formatUtcTimestamp(row.projectedExhaustion),
    credit: { incurred, projected, text: creditSummary(incurred, projected, row.penalty.incurred.kind === "credit") },
    sentence: statusExplanation(row.reason),
    nextTier: row.nextTierStartsAfterMinutes === null ? null : tierDistanceText(row.usedMinutes, row.nextTierStartsAfterMinutes),
    windowNote: proratedWindowNote(row.windowStart),
    clause: { text: clause === "" ? CLAUSE_NOT_RECORDED : clause, missing: clause === "" },
    tickets: uniqueTickets(outages),
    outages,
    reconciliation: outages.length === 0 ? "" : reconciliationText(outages),
  };
}

function technicalTracking(row: Extract<TechnicalRow, { kind: "tracking_only" }>, windowKey: string): TrackingView {
  const outages = toOutageViews(row.outages);
  return {
    key: `${row.partner}:tracking:${row.service}`,
    service: serviceLabel(row.service),
    minutes: formatMinutes(row.usedMinutes),
    incidents: String(row.incidentCount),
    usedMinutes: row.usedMinutes,
    outageCount: row.outages.length,
    comparison: comparisonText(row.comparison),
    trend: buildTrend(
      row.history,
      windowKey,
      row.usedMinutes,
      row.comparison.kind === "compared" ? row.comparison.versusMedian : null,
    ),
    outages,
    reconciliation: outages.length === 0 ? "" : reconciliationText(outages),
  };
}

function businessCreditText(figure: BusinessCredit): string {
  return figure.kind === "percent" ? formatPercent(figure.percent / 100) : penaltyText(figure);
}

function businessTerm(
  row: Extract<BusinessRow, { kind: "scored" }>,
  phase: "open" | "settled",
  windowKey: string,
): TermView {
  const used = row.consumedBudget.usedMinutes;
  const allowed = row.consumedBudget.allowedMinutes;
  const incurred = businessCreditText(row.creditPercentage.incurred);
  const projected = businessCreditText(row.creditPercentage.projected);
  return {
    key: `${row.partnerId}:${row.scope}`,
    title: row.scope,
    status: row.status,
    target: formatUptime(row.target),
    ...uptimeFields({ usedMinutes: used, windowMinutes: row.windowMinutes, elapsedMinutes: row.elapsedMinutes, phase }),
    allowed: formatMinutes(allowed),
    consumed: formatMinutes(used),
    remaining: formatMinutes(Math.max(0, allowed - used)),
    usedMinutes: used,
    allowedMinutes: allowed,
    consumedPercent: consumedText(used, allowed),
    downLine: downLine(used, allowed),
    trend: buildTrend(row.history, windowKey, used, row.versusMedian),
    exhaustion: row.projectedExhaustion === null ? EXHAUSTION_NONE : formatUtcTimestamp(row.projectedExhaustion),
    credit: { incurred, projected, text: creditSummary(incurred, projected, row.creditPercentage.incurred.kind === "percent") },
    sentence: row.summary,
    nextTier: null,
    windowNote: null,
    clause: null,
    tickets: null,
    outages: null,
    reconciliation: "",
  };
}

function businessTracking(row: Extract<BusinessRow, { kind: "tracking_only" }>, windowKey: string): TrackingView {
  return {
    key: `${row.partnerId}:tracking:${row.service}`,
    service: row.service,
    minutes: formatMinutes(row.usedMinutes),
    incidents: String(row.incidentCount),
    usedMinutes: row.usedMinutes,
    outageCount: row.incidentCount,
    comparison: row.comparison,
    trend: buildTrend(row.history, windowKey, row.usedMinutes, row.versusMedian),
    outages: null,
    reconciliation: "",
  };
}

function assemble(input: {
  id: string;
  name: string;
  terms: TermView[];
  tracking: TrackingView[];
  merchantIds: string[] | null;
  contractTerms: ContractTermsState | null;
  backtestEnabled: boolean;
}): PartnerView {
  const worst = worstStatus(input.terms.map((term) => term.status));
  return {
    id: input.id,
    name: input.name,
    merchantIds: input.merchantIds,
    terms: input.terms,
    tracking: input.tracking,
    worst,
    trackingOnly: input.terms.length === 0,
    unavailable: false,
    contractTerms: input.contractTerms,
    backtestEnabled: input.backtestEnabled,
  };
}

/** Every pilot partner in registry order, then any partner the feed named that the registry does not. */
function partnerOrder(seen: Iterable<string>): { id: string; name: string }[] {
  const pilots = listPilotPartners().map((partner) => ({ id: partner.id, name: partner.displayName }));
  const known = new Set(pilots.map((partner) => partner.id));
  const extras = [...new Set(seen)].filter((id) => !known.has(id)).map((id) => ({ id, name: partnerLabel(id) }));
  return [...pilots, ...extras];
}

export function buildTechnicalPartners(
  rows: readonly TechnicalRow[],
  phase: "open" | "settled",
  windowKey: string,
  termsIndex: TermsIndex,
): PartnerView[] {
  return partnerOrder(rows.map((row) => row.partner)).map(({ id, name }) => {
    const own = rows.filter((row) => row.partner === id);
    const terms = own.flatMap((row) => (row.kind === "scored" ? [technicalTerm(row, phase, windowKey)] : []));
    const tracking = own.flatMap((row) => (row.kind === "tracking_only" ? [technicalTracking(row, windowKey)] : []));
    const bound = termsIndex?.bound.has(id) ?? false;
    return assemble({
      id,
      name,
      terms,
      tracking,
      merchantIds: partnerMerchantIds(id).map(String),
      contractTerms: contractTermsState(id, termsIndex),
      backtestEnabled: terms.length > 0 || bound,
    });
  });
}

export function buildBusinessPartners(
  rows: readonly BusinessRow[],
  phase: "open" | "settled",
  windowKey: string,
): PartnerView[] {
  return partnerOrder(rows.map((row) => row.partnerId)).map(({ id, name }) => {
    const own = rows.filter((row) => row.partnerId === id);
    return assemble({
      id,
      name,
      terms: own.flatMap((row) => (row.kind === "scored" ? [businessTerm(row, phase, windowKey)] : [])),
      tracking: own.flatMap((row) => (row.kind === "tracking_only" ? [businessTracking(row, windowKey)] : [])),
      merchantIds: null,
      contractTerms: null,
      backtestEnabled: false,
    });
  });
}

/** Every pilot partner with nothing loaded. Pages render these as error rows, never zeros. */
export function unavailablePartners(termsIndex: TermsIndex, role: "technical" | "business"): PartnerView[] {
  return listPilotPartners().map((partner) => ({
    id: partner.id,
    name: partner.displayName,
    merchantIds: role === "technical" ? partnerMerchantIds(partner.id).map(String) : null,
    terms: [],
    tracking: [],
    worst: null,
    trackingOnly: true,
    unavailable: true,
    contractTerms: role === "technical" ? contractTermsState(partner.id, termsIndex) : null,
    backtestEnabled: termsIndex?.bound.has(partner.id) ?? false,
  }));
}
