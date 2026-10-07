import { contractedServiceIds } from "@/registry";
import {
  listPilotPartners,
  monthKeysThrough,
  partnerLabel,
  serviceLabel,
  severityLabel,
  windowFromMonthKey,
  windowPhase,
  type IngestionHealthDetail,
  type SlaFeed,
  type TechnicalRow,
} from "@/feed";
import {
  affectedServicesLine,
  BACKTEST_COUNT_NOTE,
  BACKTEST_FAILED,
  BACKTEST_NO_EXPOSURE,
  BACKTEST_TRACKING_ONLY,
  CLAUSE_NOT_RECORDED,
  EXHAUSTION_NONE,
  NO_DOWNTIME,
  NO_SERVICE,
  ROW_UNAVAILABLE,
  UNAVAILABLE,
  comparisonText,
  computedEnd,
  formatMinutes,
  formatTarget,
  formatUtcTimestamp,
  healthChip,
  ingestionDetailText,
  monthTitle,
  penaltyText,
  proratedWindowNote,
  reasonEntries,
  reconciliationText,
  reviewLine,
  statusExplanation,
  statusLabel,
  ticketHref,
  tierDistanceText,
  unresolvedValuesSummary,
  windowMinutesLabel,
} from "./copy";

export type MonthOption = {
  key: string;
  title: string;
  phase: "open" | "settled";
  href: string;
  selected: boolean;
};

export type IngestionRow = { pirKey: string; href: string | null; detail: string };

export type IngestionSection = { count: number; rows: IngestionRow[] };

export type IngestionView =
  | { status: "error" }
  | {
      status: "ok";
      failed: IngestionSection;
      unresolved: IngestionSection;
      withoutMessage: IngestionSection;
    };

export type HealthView = {
  usableCount: number;
  droppedRows: number;
  unresolvedPartnerNames: string[];
  unmatchedServiceNames: string[];
  partnersWithNoRows: string[];
  reasons: { key: string; label: string; count: number }[];
  invalidTerms: { partner: string; label: string; message: string }[];
  ingestion: IngestionView;
};

export type OutageView = {
  pirKey: string;
  href: string | null;
  started: string;
  ended: string;
  minutesLabel: string;
  service: string;
  severity: string;
  review: string | null;
  merchantId: string | null;
  source: string | null;
  mergeGroup: string;
  countedMinutes: number;
};

export type ScoredDetails = {
  target: string;
  allowance: string;
  consumed: string;
  remaining: string;
  usedMinutes: number;
  allowedMinutes: number;
  status: "meeting" | "at_risk" | "breaching";
  statusLabel: string;
  explanation: string;
  exhaustion: string;
  incurred: string;
  projected: string;
  tierDistance: string | null;
  windowNote: string | null;
  clauseText: string;
  clauseMissing: boolean;
  showFiledService: boolean;
  /** Services the outages were filed against, when that is not the scope title. */
  affected: string | null;
};

export type ScopeView = {
  key: string;
  service: string;
  minutes: string;
  incidents: string;
  comparison: string;
  tone: "recorded" | "none" | "unavailable";
  outages: OutageView[];
  reconciliation: string;
  /** Null on a tracking-only row. The row then has no status, budget, or penalty. */
  score: ScoredDetails | null;
};

export type BacktestCountedRow = {
  kind: "counted";
  key: string;
  month: string;
  scope: string;
  steps: string;
  breaching: string;
  trend: string;
  level: string;
  meeting: string;
};

export type BacktestPanel =
  | { state: "error"; message: string }
  | {
      state: "ready";
      rangeLabel: string;
      note: string;
      rows: readonly ({ kind: "none"; key: string; month: string; label: string } | BacktestCountedRow)[];
    };

export type PartnerView = {
  id: string;
  name: string;
  trackingOnly: boolean;
  /** `unknown` when the terms table could not be read. The row then offers neither action. */
  contractTerms: "add" | "view" | "unknown";
  backtestEnabled: boolean;
  backtestTooltip: string;
  backtestPanel: BacktestPanel | null;
  rows: ScopeView[];
};

export type BacktestAttachment = {
  partner: string;
  panel: BacktestPanel;
};

type Frame = {
  windowKey: string;
  windowTitle: string;
  phase: "open" | "settled";
  months: MonthOption[];
};

export type DashboardModel =
  | (Frame & {
      state: "ready";
      asOfLabel: string;
      health: HealthView;
      chip: { label: string; tone: "neutral" | "warning" };
      partners: PartnerView[];
    })
  | (Frame & {
      state: "unavailable";
      attemptedAtLabel: string;
      message: string;
      partners: PartnerView[];
    })
  | (Frame & {
      state: "business_viewer";
      asOfLabel: string;
    });

export function buildMonthOptions(asOf: Date, selectedKey: string): MonthOption[] {
  return monthKeysThrough(asOf)
    .map((key) => {
      const window = windowFromMonthKey(key);
      const phase = window === null ? "open" : windowPhase(window, asOf);
      return {
        key,
        title: monthTitle(key),
        phase,
        href: `/?window=${key}`,
        selected: key === selectedKey,
      };
    })
    .reverse();
}

export function buildHealth(input: {
  health: SlaFeed["health"];
  ingestion: IngestionHealthDetail;
  invalidTerms: readonly { partner: string; message: string }[];
}): HealthView {
  return {
    usableCount: input.health.usableCount,
    droppedRows: input.health.unusableCount,
    unresolvedPartnerNames: input.health.unresolvedPartnerNames,
    unmatchedServiceNames: input.health.unresolvedServiceNames,
    partnersWithNoRows: input.health.partnersWithZeroAttributedRows.map((id) => partnerLabel(id)),
    reasons: reasonEntries(input.health.countsByReason),
    invalidTerms: input.invalidTerms.map((row) => ({
      partner: row.partner,
      label: partnerLabel(row.partner),
      message: row.message,
    })),
    ingestion: buildIngestionView(input.ingestion),
  };
}

/**
 * `status: "error"` renders as an explicit error state in the panel, never
 * as zero counts (main spec §9.3: zero and error must never look alike).
 */
function buildIngestionView(ingestion: IngestionHealthDetail): IngestionView {
  if (ingestion.status === "error") {
    return { status: "error" };
  }
  return {
    status: "ok",
    failed: {
      count: ingestion.counts.failed,
      rows: ingestion.failed.map((row) => ({
        pirKey: row.pirKey,
        href: ticketHref(row.pirUrl),
        detail: row.error === null ? "" : ingestionDetailText(row.error),
      })),
    },
    unresolved: {
      count: ingestion.counts.unresolved,
      rows: ingestion.unresolved.map((row) => ({
        pirKey: row.pirKey,
        href: ticketHref(row.pirUrl),
        detail: unresolvedValuesSummary(row.values),
      })),
    },
    withoutMessage: {
      count: ingestion.counts.withoutMessage,
      rows: ingestion.withoutMessage.map((row) => ({
        pirKey: row.pirKey,
        href: ticketHref(row.pirUrl),
        detail: ingestionDetailText(row.slackError),
      })),
    },
  };
}

export function buildReadyDashboard(input: {
  asOf: Date;
  windowKey: string;
  feed: Extract<SlaFeed, { role: "technical" | "system" }>;
  partnersWithTerms?: ReadonlySet<string> | null;
  boundPartners?: ReadonlySet<string> | null;
  backtest?: BacktestAttachment | null;
}): Extract<DashboardModel, { state: "ready" }> {
  const health = buildHealth({
    health: input.feed.health,
    ingestion: input.feed.ingestion,
    invalidTerms: input.feed.invalidTerms,
  });
  return {
    state: "ready",
    asOfLabel: formatUtcTimestamp(input.feed.asOf),
    windowKey: input.windowKey,
    windowTitle: monthTitle(input.windowKey),
    phase: phaseFor(input.windowKey, input.asOf),
    months: buildMonthOptions(input.asOf, input.windowKey),
    health,
    chip: healthChip({
      unusableCount: health.droppedRows,
      partnersWithNoRows: health.partnersWithNoRows.length,
      invalidTerms: health.invalidTerms.length,
    }),
    partners: withBacktest(
      buildPartnerGroups(input.feed.rows, input.partnersWithTerms ?? null, input.boundPartners ?? null),
      input.backtest,
    ),
  };
}

export function buildUnavailableDashboard(input: {
  asOf: Date;
  windowKey: string;
  message: string;
  partnersWithTerms?: ReadonlySet<string> | null;
  boundPartners?: ReadonlySet<string> | null;
  backtest?: BacktestAttachment | null;
}): Extract<DashboardModel, { state: "unavailable" }> {
  return {
    state: "unavailable",
    attemptedAtLabel: formatUtcTimestamp(input.asOf.toISOString()),
    message: input.message,
    windowKey: input.windowKey,
    windowTitle: monthTitle(input.windowKey),
    phase: phaseFor(input.windowKey, input.asOf),
    months: buildMonthOptions(input.asOf, input.windowKey),
    partners: withBacktest(
      listPilotPartners().map((partner) => ({
        id: partner.id,
        name: partner.displayName,
        trackingOnly: true,
        contractTerms: contractTermsAction(partner.id, input.partnersWithTerms ?? null),
        backtestEnabled: backtestEnabled(partner.id, false, input.boundPartners ?? null),
        backtestTooltip: BACKTEST_TRACKING_ONLY,
        backtestPanel: null,
        rows: [
          {
            key: `${partner.id}:unavailable`,
            service: UNAVAILABLE,
            minutes: UNAVAILABLE,
            incidents: UNAVAILABLE,
            comparison: ROW_UNAVAILABLE,
            tone: "unavailable" as const,
            outages: [],
            reconciliation: "",
            score: null,
          },
        ],
      })),
      input.backtest,
    ),
  };
}

export function buildBusinessViewerDashboard(input: {
  asOf: Date;
  windowKey: string;
}): Extract<DashboardModel, { state: "business_viewer" }> {
  return {
    state: "business_viewer",
    asOfLabel: formatUtcTimestamp(input.asOf.toISOString()),
    windowKey: input.windowKey,
    windowTitle: monthTitle(input.windowKey),
    phase: phaseFor(input.windowKey, input.asOf),
    months: buildMonthOptions(input.asOf, input.windowKey),
  };
}

export function buildPartnerGroups(
  rows: readonly TechnicalRow[],
  partnersWithTerms: ReadonlySet<string> | null = null,
  boundPartners: ReadonlySet<string> | null = null,
): PartnerView[] {
  const byPartner = new Map<string, TechnicalRow[]>();
  for (const row of rows) {
    const list = byPartner.get(row.partner) ?? [];
    list.push(row);
    byPartner.set(row.partner, list);
  }

  const seen = new Set<string>();
  const groups: PartnerView[] = [];
  for (const partner of listPilotPartners()) {
    seen.add(partner.id);
    groups.push(
      toPartnerView(partner.id, partner.displayName, byPartner.get(partner.id) ?? [], partnersWithTerms, boundPartners),
    );
  }
  for (const [id, partnerRows] of byPartner) {
    if (seen.has(id)) {
      continue;
    }
    groups.push(toPartnerView(id, partnerLabel(id), partnerRows, partnersWithTerms, boundPartners));
  }
  return groups;
}

function contractTermsAction(
  id: string,
  partnersWithTerms: ReadonlySet<string> | null,
): PartnerView["contractTerms"] {
  if (partnersWithTerms === null) {
    return "unknown";
  }
  return partnersWithTerms.has(id) ? "view" : "add";
}

function backtestEnabled(id: string, hasScoredRow: boolean, boundPartners: ReadonlySet<string> | null): boolean {
  if (hasScoredRow) {
    return true;
  }
  return boundPartners?.has(id) ?? false;
}

function toPartnerView(
  id: string,
  name: string,
  rows: readonly TechnicalRow[],
  partnersWithTerms: ReadonlySet<string> | null,
  boundPartners: ReadonlySet<string> | null,
): PartnerView {
  const trackingOnly = rows.every((row) => row.kind === "tracking_only");
  const hasScoredRow = rows.some((row) => row.kind === "scored");
  const contractTerms = contractTermsAction(id, partnersWithTerms);
  const enabled = backtestEnabled(id, hasScoredRow, boundPartners);
  if (rows.length === 0) {
    return {
      id,
      name,
      trackingOnly: true,
      contractTerms,
      backtestEnabled: enabled,
      backtestTooltip: BACKTEST_TRACKING_ONLY,
      backtestPanel: null,
      rows: [
        {
          key: `${id}:none`,
          service: NO_SERVICE,
          minutes: formatMinutes(0),
          incidents: "0",
          comparison: NO_DOWNTIME,
          tone: "none",
          outages: [],
          reconciliation: "",
          score: null,
        },
      ],
    };
  }
  return {
    id,
    name,
    trackingOnly,
    contractTerms,
    backtestEnabled: enabled,
    backtestTooltip: BACKTEST_TRACKING_ONLY,
    backtestPanel: null,
    rows: rows.map((row, index) => toScopeView(id, row, index)),
  };
}

export function backtestErrorPanel(): BacktestPanel {
  return { state: "error", message: BACKTEST_FAILED };
}

export function toBacktestPanel(report: {
  range: { description: string; from: string; through: string };
  partners: readonly {
    months: readonly {
      month: string;
      exposure: boolean;
      scopes: readonly {
        scopeId: string;
        steps: number;
        rules: { breaching: number; trend: number; level: number; meeting: number };
      }[];
    }[];
  }[];
}): BacktestPanel {
  const months = report.partners[0]?.months ?? [];
  const rows: Extract<BacktestPanel, { state: "ready" }>["rows"][number][] = [];
  for (const month of months) {
    if (!month.exposure || month.scopes.length === 0) {
      rows.push({
        kind: "none",
        key: month.month,
        month: monthTitle(month.month),
        label: BACKTEST_NO_EXPOSURE,
      });
      continue;
    }
    for (const scope of month.scopes) {
      rows.push({
        kind: "counted",
        key: `${month.month}:${scope.scopeId}`,
        month: monthTitle(month.month),
        scope: scope.scopeId,
        steps: String(scope.steps),
        breaching: String(scope.rules.breaching),
        trend: String(scope.rules.trend),
        level: String(scope.rules.level),
        meeting: String(scope.rules.meeting),
      });
    }
  }
  return {
    state: "ready",
    rangeLabel: `${report.range.description}: ${report.range.from} through ${report.range.through}`,
    note: BACKTEST_COUNT_NOTE,
    rows,
  };
}

function withBacktest(partners: PartnerView[], backtest: BacktestAttachment | null | undefined): PartnerView[] {
  if (backtest == null) {
    return partners;
  }
  return partners.map((partner) =>
    partner.id === backtest.partner ? { ...partner, backtestPanel: backtest.panel } : partner,
  );
}

function toScopeView(partnerId: string, row: TechnicalRow, index: number): ScopeView {
  const outages = [...row.outages]
    .sort((left, right) => {
      const byTime = right.incidentStarted.localeCompare(left.incidentStarted);
      if (byTime !== 0) {
        return byTime;
      }
      return right.pirKey.localeCompare(left.pirKey);
    })
    .map((outage) => ({
      pirKey: outage.pirKey,
      href: ticketHref(outage.pirUrl),
      started: formatUtcTimestamp(outage.incidentStarted),
      ended: computedEnd(outage.incidentStarted, outage.totalMinutes),
      minutesLabel: windowMinutesLabel(outage.totalMinutes, outage.minutesInWindow),
      service: serviceLabel(outage.service),
      severity: severityLabel(outage.severity),
      review: reviewLine(outage),
      merchantId: outage.partnerId === null ? null : String(outage.partnerId),
      source: outage.source,
      mergeGroup: outage.mergeGroup,
      countedMinutes: outage.countedMinutes,
    }));
  const reconciliation = outages.length === 0 ? "" : reconciliationText(outages);

  if (row.kind === "tracking_only") {
    return {
      key: `${partnerId}:${row.service}:${index}`,
      service: serviceLabel(row.service),
      minutes: formatMinutes(row.usedMinutes),
      incidents: String(row.incidentCount),
      comparison: comparisonText(row.comparison),
      tone: "recorded",
      outages,
      reconciliation,
      score: null,
    };
  }

  const clause = row.sourceClause.trim();
  const clauseMissing = clause === "";
  const service = scopeTitle(row);
  return {
    key: `${partnerId}:${row.scopeId}:${index}`,
    service,
    minutes: formatMinutes(row.usedMinutes),
    incidents: String(row.outages.length),
    comparison: "",
    tone: "recorded",
    outages,
    reconciliation,
    score: {
      target: formatTarget(row.target),
      allowance: formatMinutes(row.allowedMinutes),
      consumed: formatMinutes(row.usedMinutes),
      remaining: formatMinutes(row.remainingMinutes),
      usedMinutes: row.usedMinutes,
      allowedMinutes: row.allowedMinutes,
      status: row.status,
      statusLabel: statusLabel(row.status),
      explanation: statusExplanation(row.reason),
      exhaustion: row.projectedExhaustion === null ? EXHAUSTION_NONE : formatUtcTimestamp(row.projectedExhaustion),
      incurred: penaltyText(row.penalty.incurred),
      projected: penaltyText(row.penalty.projected),
      tierDistance:
        row.nextTierStartsAfterMinutes === null
          ? null
          : tierDistanceText(row.usedMinutes, row.nextTierStartsAfterMinutes),
      windowNote: proratedWindowNote(row.windowStart),
      clauseText: clauseMissing ? CLAUSE_NOT_RECORDED : clause,
      clauseMissing,
      showFiledService: row.services.length > 1 || row.services.includes("webshop"),
      affected: affectedLine(service, outages.map((outage) => outage.service)),
    },
  };
}

function affectedLine(scopeTitle: string, filedServices: readonly string[]): string | null {
  const filed = [...new Set(filedServices)];
  if (filed.length === 0) {
    return null;
  }
  const named = new Set(scopeTitle.split(", "));
  const sameService = filed.length === named.size && filed.every((service) => named.has(service));
  return sameService ? null : affectedServicesLine(filed);
}

function scopeTitle(row: Extract<TechnicalRow, { kind: "scored" }>): string {
  if (row.services.length > 0) {
    return contractedServiceIds(row.services).map((service) => serviceLabel(service)).join(", ");
  }
  if (row.includesScopedServices === true) {
    return "All services";
  }
  if (row.includesScopedServices === false) {
    return "General Scope";
  }
  return row.scopeId;
}

function phaseFor(windowKey: string, asOf: Date): "open" | "settled" {
  const window = windowFromMonthKey(windowKey);
  if (window === null) {
    return "open";
  }
  return windowPhase(window, asOf);
}
