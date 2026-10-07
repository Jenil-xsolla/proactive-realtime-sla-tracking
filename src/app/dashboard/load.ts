import { unstable_noStore as noStore } from "next/cache";
import { cookies } from "next/headers";
import { getDatabase, listAlertState, readContractTerms, type AlertStateRow } from "@/data";
import {
  getSlaFeed,
  getSlaHealth,
  listPilotPartners,
  resolveDashboardWindow,
  resolveViewer,
  VIEW_COOKIE,
  windowFromMonthKey,
  windowPhase,
  type TechnicalRow,
  type UnusableRow,
  type Viewer,
} from "@/feed";
import { QUERY_FAILED, VIEWER_UNCONFIGURED, formatUtcTimestamp, monthTitle } from "./copy";
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

export type Workspace = {
  role: "technical" | "business";
  frame: Frame;
  partners: PartnerView[];
  /** QUERY_FAILED or VIEWER_UNCONFIGURED. Partners are then unavailablePartners(). */
  failure: string | null;
  /** Null for business. */
  health: HealthView | { status: "error" } | null;
  /** Technical only, and only when requested with `unusable: true`. Null otherwise, and when the read failed. */
  unusable: UnusableRow[] | null;
  /** Null for business. */
  alerts: AlertStateRow[] | { status: "error" } | null;
  /** Which segment of the top-bar toggle is active. */
  view: { active: "technical" | "business" };
  termsIndex: TermsIndex;
  backtest: BacktestAttachment | null;
};

/**
 * One feed read per request. Every page derives its sidebar, tiles, and tables from the result.
 * `windowPath` is the route the month picker reloads; `unusable` opts in to the second health read.
 */
export async function loadWorkspace(
  input: { window?: string; backtestPartner?: string; windowPath?: string; unusable?: boolean } = {},
): Promise<Workspace> {
  noStore();
  const asOf = new Date();
  const resolved = resolveDashboardWindow(input.window, asOf);
  const phase = phaseFor(resolved.key, asOf);
  const frame: Frame = {
    windowKey: resolved.key,
    windowTitle: monthTitle(resolved.key),
    phase,
    months: buildMonthOptions(asOf, resolved.key, input.windowPath),
    asOfLabel: formatUtcTimestamp(asOf.toISOString()),
  };

  // Read outside the try: a dynamic-API bailout must not be mistaken for a bad VIEWER_ROLE.
  const override = (await cookies()).get(VIEW_COOKIE)?.value;
  let viewer: Viewer;
  try {
    viewer = resolveViewer(override);
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
      view: { active: "technical" },
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
    const [alerts, backtest] =
      role === "technical"
        ? await Promise.all([loadAlerts(), loadBacktest(pilotPartner(input.backtestPartner), asOf, termsIndex?.bound ?? null, null)])
        : [null, null];
    return {
      role,
      frame,
      partners: unavailablePartners(termsIndex, role),
      failure: QUERY_FAILED,
      health: role === "technical" ? { status: "error" } : null,
      unusable: null,
      alerts,
      view: { active: role },
      termsIndex,
      backtest,
    };
  }

  if (feed.role === "business") {
    return {
      role: "business",
      frame,
      partners: buildBusinessPartners(feed.rows, phase, resolved.key),
      failure: null,
      health: null,
      unusable: null,
      alerts: null,
      view: { active: "business" },
      termsIndex: null,
      backtest: null,
    };
  }

  const partners = buildTechnicalPartners(feed.rows, phase, resolved.key, termsIndex);
  const health = buildHealth({ health: feed.health, ingestion: feed.ingestion, invalidTerms: feed.invalidTerms });
  const [alerts, backtest, unusable] = await Promise.all([
    loadAlerts(),
    loadBacktest(pilotPartner(input.backtestPartner), asOf, termsIndex?.bound ?? null, feed.rows),
    input.unusable === true ? loadUnusable(asOf, viewer) : Promise.resolve(null),
  ]);
  return {
    role: "technical",
    frame,
    partners,
    failure: null,
    health,
    unusable,
    alerts,
    view: { active: "technical" },
    termsIndex,
    backtest,
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
