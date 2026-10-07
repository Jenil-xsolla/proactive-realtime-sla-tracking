import { unstable_noStore as noStore } from "next/cache";
import { getDatabase, readContractTerms } from "@/data";
import { getSlaFeed, getViewer, listPilotPartners, resolveDashboardWindow, type TechnicalRow } from "@/feed";
import { QUERY_FAILED, VIEWER_UNCONFIGURED } from "./copy";
import {
  backtestErrorPanel,
  buildBusinessViewerDashboard,
  buildReadyDashboard,
  buildUnavailableDashboard,
  toBacktestPanel,
  type BacktestAttachment,
  type DashboardModel,
} from "./model";
import { runPartnerBacktest } from "./run-backtest";

export async function loadDashboard(
  requestedWindow: string | undefined,
  requestedBacktest?: string,
): Promise<DashboardModel> {
  noStore();
  const asOf = new Date();
  const resolved = resolveDashboardWindow(requestedWindow, asOf);
  const backtestPartner = pilotPartner(requestedBacktest);

  let viewer;
  try {
    viewer = getViewer();
  } catch (error) {
    console.error("[sla-dashboard] viewer", error);
    return buildUnavailableDashboard({
      asOf,
      windowKey: resolved.key,
      message: VIEWER_UNCONFIGURED,
    });
  }

  if (viewer.role === "business") {
    return buildBusinessViewerDashboard({ asOf, windowKey: resolved.key });
  }

  const termsIndex = await loadTermsIndex();

  try {
    const feed = await getSlaFeed({
      asOf,
      window: resolved.window,
      viewer,
    });
    if (feed.role === "business") {
      return buildBusinessViewerDashboard({ asOf, windowKey: resolved.key });
    }
    const backtest = await loadBacktest(backtestPartner, asOf, termsIndex.bound, feed.rows);
    return buildReadyDashboard({
      asOf,
      windowKey: resolved.key,
      feed,
      partnersWithTerms: termsIndex.withTerms,
      boundPartners: termsIndex.bound,
      backtest,
    });
  } catch (error) {
    console.error("[sla-dashboard] feed", error);
    const backtest = await loadBacktest(backtestPartner, asOf, termsIndex.bound, null);
    return buildUnavailableDashboard({
      asOf,
      windowKey: resolved.key,
      message: QUERY_FAILED,
      partnersWithTerms: termsIndex.withTerms,
      boundPartners: termsIndex.bound,
      backtest,
    });
  }
}

type TermsIndex = {
  /** Null when the terms table could not be read. */
  withTerms: ReadonlySet<string> | null;
  /** Partners whose stored lifecycle is `contract_bound`. Null when the table could not be read. */
  bound: ReadonlySet<string> | null;
};

/**
 * Null sets when the terms table cannot be read. The dashboard then does not
 * guess Add versus View, and does not enable backtest from the table alone.
 */
async function loadTermsIndex(): Promise<TermsIndex> {
  try {
    const rows = await readContractTerms(getDatabase());
    return {
      withTerms: new Set(rows.map((row) => row.partnerSlug)),
      bound: new Set(rows.filter((row) => row.lifecycle === "contract_bound").map((row) => row.partnerSlug)),
    };
  } catch (error) {
    console.error("[sla-dashboard] contract terms", error);
    return { withTerms: null, bound: null };
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
