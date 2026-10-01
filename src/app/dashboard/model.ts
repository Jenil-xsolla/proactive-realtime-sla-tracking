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
  BACKTEST_NOT_ON_SCREEN,
  BACKTEST_TRACKING_ONLY,
  NO_DOWNTIME,
  ROW_UNAVAILABLE,
  UNAVAILABLE,
  comparisonText,
  computedEnd,
  formatMinutes,
  formatUtcTimestamp,
  healthChip,
  ingestionDetailText,
  monthTitle,
  reasonEntries,
  reconciliationText,
  reviewLine,
  ticketHref,
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

export type ScopeView = {
  key: string;
  service: string;
  minutes: string;
  incidents: string;
  comparison: string;
  tone: "recorded" | "none" | "unavailable";
  outages: OutageView[];
  reconciliation: string;
};

export type PartnerView = {
  id: string;
  name: string;
  trackingOnly: boolean;
  /** `unknown` when the terms table could not be read. The row then offers neither action. */
  contractTerms: "add" | "view" | "unknown";
  backtestTooltip: string;
  rows: ScopeView[];
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
    partners: buildPartnerGroups(input.feed.rows, input.partnersWithTerms ?? null),
  };
}

export function buildUnavailableDashboard(input: {
  asOf: Date;
  windowKey: string;
  message: string;
  partnersWithTerms?: ReadonlySet<string> | null;
}): Extract<DashboardModel, { state: "unavailable" }> {
  return {
    state: "unavailable",
    attemptedAtLabel: formatUtcTimestamp(input.asOf.toISOString()),
    message: input.message,
    windowKey: input.windowKey,
    windowTitle: monthTitle(input.windowKey),
    phase: phaseFor(input.windowKey, input.asOf),
    months: buildMonthOptions(input.asOf, input.windowKey),
    partners: listPilotPartners().map((partner) => ({
      id: partner.id,
      name: partner.displayName,
      trackingOnly: true,
      contractTerms: contractTermsAction(partner.id, input.partnersWithTerms ?? null),
      backtestTooltip: BACKTEST_TRACKING_ONLY,
      rows: [
        {
          key: `${partner.id}:unavailable`,
          service: UNAVAILABLE,
          minutes: UNAVAILABLE,
          incidents: UNAVAILABLE,
          comparison: ROW_UNAVAILABLE,
          tone: "unavailable",
          outages: [],
          reconciliation: "",
        },
      ],
    })),
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
    groups.push(toPartnerView(partner.id, partner.displayName, byPartner.get(partner.id) ?? [], partnersWithTerms));
  }
  for (const [id, partnerRows] of byPartner) {
    if (seen.has(id)) {
      continue;
    }
    groups.push(toPartnerView(id, partnerLabel(id), partnerRows, partnersWithTerms));
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

function toPartnerView(
  id: string,
  name: string,
  rows: readonly TechnicalRow[],
  partnersWithTerms: ReadonlySet<string> | null,
): PartnerView {
  const trackingOnly = rows.every((row) => row.kind === "tracking_only");
  const contractTerms = contractTermsAction(id, partnersWithTerms);
  if (rows.length === 0) {
    return {
      id,
      name,
      trackingOnly: true,
      contractTerms,
      backtestTooltip: BACKTEST_TRACKING_ONLY,
      rows: [
        {
          key: `${id}:none`,
          service: "—",
          minutes: formatMinutes(0),
          incidents: "0",
          comparison: NO_DOWNTIME,
          tone: "none",
          outages: [],
          reconciliation: "",
        },
      ],
    };
  }
  return {
    id,
    name,
    trackingOnly,
    contractTerms,
    backtestTooltip: trackingOnly ? BACKTEST_TRACKING_ONLY : BACKTEST_NOT_ON_SCREEN,
    rows: rows.map((row, index) => toScopeView(id, row, index)),
  };
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
    };
  }

  return {
    key: `${partnerId}:${row.scopeId}:${index}`,
    service: row.scopeId,
    minutes: formatMinutes(row.usedMinutes),
    incidents: String(row.outages.length),
    comparison: "—",
    tone: "recorded",
    outages,
    reconciliation,
  };
}

function phaseFor(windowKey: string, asOf: Date): "open" | "settled" {
  const window = windowFromMonthKey(windowKey);
  if (window === null) {
    return "open";
  }
  return windowPhase(window, asOf);
}
