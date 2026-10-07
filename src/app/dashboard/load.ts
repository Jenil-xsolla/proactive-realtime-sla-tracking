import { unstable_noStore as noStore } from "next/cache";
import { getDatabase, listAlertState, readContractTerms, type AlertStateRow } from "@/data";
import {
  getSlaFeed,
  getSlaHealth,
  getViewer,
  listPilotPartners,
  resolveDashboardWindow,
  windowFromMonthKey,
  windowPhase,
  type TechnicalRow,
  type UnusableRow,
  type Viewer,
} from "@/feed";
import { HEALTH_UNAVAILABLE_CHIP, QUERY_FAILED, VIEWER_UNCONFIGURED, formatUtcTimestamp, healthChip, monthTitle } from "./copy";
import {
  backtestErrorPanel,
  buildHealth,
  buildMonthOptions,
  toBacktestPanel,
  type BacktestAttachment,
  type HealthView,
  type MonthOption,
} from "./model";
import { runPartnerBacktest } from "./run-backtest";
import { buildBusinessPartners, buildTechnicalPartners, unavailablePartners, type PartnerView, type TermsIndex } from "./view";

export { alertsBadge, healthBadge } from "./badges";

export type Frame = {
  windowKey: string;
  windowTitle: string;
  phase: "open" | "settled";
  months: MonthOption[];
  asOfLabel: string;
};
export type Chip = { label: string; tone: "neutral" | "warning" | "danger"; href: string | null };

export type Workspace = {
  role: "technical" | "business";
  frame: Frame;
  partners: PartnerView[];
  /** QUERY_FAILED or VIEWER_UNCONFIGURED. Partners are then unavailablePartners(). */
  failure: string | null;
  /** Null for business. */
  health: HealthView | { status: "error" } | null;
  /** Technical only. Null when the health read failed. */
  unusable: UnusableRow[] | null;
  /** Null for business. */
  alerts: AlertStateRow[] | { status: "error" } | null;
  chip: Chip;
  termsIndex: TermsIndex;
  backtest: BacktestAttachment | null;
};

/** One feed read per request. Every page derives its sidebar, tiles, and tables from the result. */
export async function loadWorkspace(input: { window?: string; backtestPartner?: string } = {}): Promise<Workspace> {
  noStore();
  const asOf = new Date();
  const resolved = resolveDashboardWindow(input.window, asOf);
  const phase = phaseFor(resolved.key, asOf);
  const frame: Frame = {
    windowKey: resolved.key,
    windowTitle: monthTitle(resolved.key),
    phase,
    months: buildMonthOptions(asOf, resolved.key),
    asOfLabel: formatUtcTimestamp(asOf.toISOString()),
  };

  let viewer: Viewer;
  try {
    viewer = getViewer();
  } catch (error) {
    console.error("[sla-dashboard] viewer", error);
    return {
      role: "technical",
      frame,
      partners: unavailablePartners(null, "technical"),
      failure: VIEWER_UNCONFIGURED,
      health: { status: "error" },
      unusable: null,
      alerts: { status: "error" },
      chip: { label: HEALTH_UNAVAILABLE_CHIP, tone: "danger", href: "/health" },
      termsIndex: null,
      backtest: null,
    };
  }
  const role = viewer.role === "business" ? "business" : "technical";
  const termsIndex = role === "technical" ? await loadTermsIndex() : null;

  let feed;
  try {
    feed = await getSlaFeed({ asOf, window: resolved.window, viewer });
  } catch (error) {
    console.error("[sla-dashboard] feed", error);
    return {
      role,
      frame,
      partners: unavailablePartners(termsIndex, role),
      failure: QUERY_FAILED,
      health: role === "technical" ? { status: "error" } : null,
      unusable: null,
      alerts: role === "technical" ? await loadAlerts() : null,
      chip: { label: HEALTH_UNAVAILABLE_CHIP, tone: "danger", href: role === "technical" ? "/health" : null },
      termsIndex,
      backtest: role === "technical" ? await loadBacktest(pilotPartner(input.backtestPartner), asOf, termsIndex?.bound ?? null, null) : null,
    };
  }

  if (feed.role === "business") {
    const chip = healthChip({ unusableCount: feed.health.unusableCount, partnersWithNoRows: 0 });
    return {
      role: "business",
      frame,
      partners: buildBusinessPartners(feed.rows, phase, resolved.key),
      failure: null,
      health: null,
      unusable: null,
      alerts: null,
      chip: { ...chip, href: null },
      termsIndex: null,
      backtest: null,
    };
  }

  const partners = buildTechnicalPartners(feed.rows, phase, resolved.key, termsIndex);
  const health = buildHealth({ health: feed.health, ingestion: feed.ingestion, invalidTerms: feed.invalidTerms });
  const chip = healthChip({
    unusableCount: health.droppedRows,
    partnersWithNoRows: health.partnersWithNoRows.length,
    invalidTerms: health.invalidTerms.length,
  });
  return {
    role: "technical",
    frame,
    partners,
    failure: null,
    health,
    unusable: await loadUnusable(asOf, viewer),
    alerts: await loadAlerts(),
    chip: { ...chip, href: "/health" },
    termsIndex,
    backtest: await loadBacktest(pilotPartner(input.backtestPartner), asOf, termsIndex?.bound ?? null, feed.rows),
  };
}

async function loadAlerts(): Promise<AlertStateRow[] | { status: "error" }> {
  try {
    return await listAlertState(getDatabase());
  } catch (error) {
    console.error("[sla-dashboard] alert state", error);
    return { status: "error" };
  }
}

/** The unusable rows only; the counts already came with the feed. */
async function loadUnusable(asOf: Date, viewer: Viewer): Promise<UnusableRow[] | null> {
  try {
    const health = await getSlaHealth({ asOf, viewer });
    return health.role === "business" ? null : health.unusable;
  } catch (error) {
    console.error("[sla-dashboard] health detail", error);
    return null;
  }
}

function phaseFor(windowKey: string, asOf: Date): "open" | "settled" {
  const window = windowFromMonthKey(windowKey);
  return window === null ? "open" : windowPhase(window, asOf);
}

/**
 * Null when the terms table cannot be read. The dashboard then does not
 * guess Add versus View, and does not enable backtest from the table alone.
 */
async function loadTermsIndex(): Promise<TermsIndex> {
  try {
    const rows = await readContractTerms(getDatabase());
    return {
      withTerms: new Set(rows.map((row) => row.partnerSlug)),
      bound: new Set(rows.filter((row) => row.lifecycle === "contract_bound").map((row) => row.partnerSlug)),
      draft: new Set(rows.filter((row) => row.lifecycle === "terms_pending_review").map((row) => row.partnerSlug)),
    };
  } catch (error) {
    console.error("[sla-dashboard] contract terms", error);
    return null;
  }
}

function pilotPartner(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const id = value.trim();
  return listPilotPartners().some((partner) => partner.id === id) ? id : undefined;
}

async function loadBacktest(
  partner: string | undefined,
  through: Date,
  bound: ReadonlySet<string> | null,
  rows: readonly TechnicalRow[] | null,
): Promise<BacktestAttachment | null> {
  if (partner === undefined) {
    return null;
  }
  const scored = rows?.some((row) => row.partner === partner && row.kind === "scored") ?? false;
  if (!scored && !(bound?.has(partner) ?? false)) {
    return null;
  }
  try {
    const report = await runPartnerBacktest(partner, through);
    return { partner, panel: toBacktestPanel(report) };
  } catch (error) {
    console.error("[sla-dashboard] backtest", error);
    return { partner, panel: backtestErrorPanel() };
  }
}
