import {
  monthKeysThrough,
  partnerLabel,
  windowFromMonthKey,
  windowPhase,
  type IngestionHealthDetail,
  type SlaFeed,
  type UnusableRow,
} from "@/feed";
import {
  BACKTEST_COUNT_NOTE,
  BACKTEST_FAILED,
  BACKTEST_NO_EXPOSURE,
  formatUtcTimestamp,
  ingestionDetailText,
  monthTitle,
  reasonEntries,
  reasonLabel,
  ticketHref,
  unresolvedValuesSummary,
} from "./copy";
import { withWindow } from "./nav";

export type { OutageView } from "./outage-view";

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

export type BacktestAttachment = {
  partner: string;
  panel: BacktestPanel;
};

export function buildMonthOptions(asOf: Date, selectedKey: string, basePath = "/"): MonthOption[] {
  return monthKeysThrough(asOf)
    .map((key) => {
      const window = windowFromMonthKey(key);
      const phase = window === null ? "open" : windowPhase(window, asOf);
      return {
        key,
        title: monthTitle(key),
        phase,
        href: withWindow(basePath, key),
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

export type UnusableRowView = { pirKey: string; partner: string; merchantId: string; service: string; started: string; rawMinutes: string; reasons: string[] };

export function unusableRows(rows: readonly UnusableRow[]): UnusableRowView[] {
  return rows.map((row) => ({
    pirKey: row.pirKey,
    partner: row.partner,
    merchantId: row.partnerId === null ? "" : String(row.partnerId),
    service: row.affectedService ?? "",
    started: row.incidentStarted === null ? "" : formatUtcTimestamp(row.incidentStarted),
    rawMinutes: row.rawOutageMinutes ?? "",
    reasons: row.reasons.map((reason) => reasonLabel(reason)),
  }));
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
