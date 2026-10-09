import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BACKTEST_FAILED, BACKTEST_TRACKING_ONLY, CLAUSE_NOT_RECORDED, FILED_AGAINST, CONTRACT_ON_FILE, NO_DOWNTIME, NO_TERMS, NO_TICKETS, OUTSIDE_SCOPES, QUERY_FAILED, ROW_UNAVAILABLE, SETTLED_NOTE, TRACKING_ONLY_NOTE, proratedWindowNote, tierDistanceText } from "@/app/dashboard/copy";
import { toBacktestPanel } from "@/app/dashboard/model";
import { buildPartnerPage } from "@/app/dashboard/partner-page";
import { PartnerPageView } from "@/app/dashboard/partner-page-view";
import { buildBusinessPartners, buildTechnicalPartners, unavailablePartners } from "@/app/dashboard/view";
import { businessScoredRow, scoredRow, trackingRow } from "../support/rows";

const index = { withTerms: new Set(["scopely"]), bound: new Set(["scopely"]), draft: new Set<string>() };

function technical(rows: Parameters<typeof buildTechnicalPartners>[0], id = "scopely") {
  const partner = buildTechnicalPartners(rows, "open", "2026-09", index).find((entry) => entry.id === id);
  if (partner === undefined) throw new Error("missing partner");
  return partner;
}

describe("partner page", () => {
  it("builds header meta, tiles, terms, and the outside-scope table for a scored partner", () => {
    const view = buildPartnerPage({
      partner: technical([scoredRow(), trackingRow({ service: "login", usedMinutes: 9, incidentCount: 1 })]),
      phase: "open", windowKey: "2026-09", failure: null, role: "technical",
    });
    expect(view.meta).toEqual(["Merchant ID 151639", "1 term"]);
    expect(view.termsLink).toEqual({ label: CONTRACT_ON_FILE, href: "/partners/scopely/terms" });
    expect(view.tiles.map((tile) => `${tile.label}=${tile.value}`)).toEqual([
      "Covered services=1", "At risk=1 / 1", "Breached=1", "Downtime this window=76 min",
    ]);
    expect(view.tiles[0]?.detail).toBe("2 outage instances");
    expect(view.tiles[3]?.detail).toBe("of 21.6 min allowed");
    expect(view.trackingHeading).toBe(OUTSIDE_SCOPES);
    expect(view.backtest?.enabled).toBe(true);

    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).toContain("76.0 / 21.6 min down");
    expect(html).toContain("351.9% consumed");
    expect(html).toContain('href="https://jira.example/browse/GTO-600"');
    expect(html).toContain("GTO-601");
    expect(html).toContain(CLAUSE_NOT_RECORDED);
    expect(html).toContain("<details");
    expect(html).toContain("Started");
    expect(html).toContain("UPTIME · MONTHLY");
    expect(html).not.toContain("—");
  });

  it("renders a tracking-only partner with the note, no cards, and No terms tiles", () => {
    const view = buildPartnerPage({
      partner: technical([trackingRow({ partner: "kabam" })], "kabam"),
      phase: "settled", windowKey: "2026-09", failure: null, role: "technical",
    });
    expect(view.tiles.map((tile) => tile.value)).toEqual([NO_TERMS, NO_TERMS, NO_TERMS, "42 min"]);
    expect(view.trackingNote).toBe(TRACKING_ONLY_NOTE);
    expect(view.termsLink).toEqual({ label: "Add contract terms", href: "/partners/kabam/terms" });
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).not.toContain("UPTIME · MONTHLY");
    expect(html).toContain("Compared with recent months");
  });

  it("renders the business variant without merchant id, backtest, tickets, clause, or outage expanders", () => {
    const partner = buildBusinessPartners([businessScoredRow()], "open", "2026-09").find((entry) => entry.id === "scopely");
    const view = buildPartnerPage({ partner: partner!, phase: "open", windowKey: "2026-09", failure: null, role: "business" });
    expect(view.meta).toEqual(["1 term", "Monthly window"]);
    expect(view.backtest).toBeNull();
    expect(view.termsLink).toBeNull();
    expect(view.tiles.map((tile) => `${tile.label}=${tile.value}`)).toEqual([
      "Covered services=1", "At risk=1 / 1", "Breached=0", "Downtime this window=18.4 min",
    ]);
    expect(view.tiles[0]?.detail).toBeNull();
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).not.toContain("151639");
    expect(html).not.toContain("data-outages");
    expect(html).toContain("Window trend");
    expect(html).not.toContain("Tickets");
    expect(html).not.toContain("Clause");
    expect(html).toContain("99.915%");
  });

  it("shows the empty tickets sentence and the failure state distinctly", () => {
    const empty = buildPartnerPage({ partner: technical([scoredRow({ outages: [], usedMinutes: 0 })]), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    expect(renderToStaticMarkup(<PartnerPageView view={empty} backtest={null} />)).toContain(NO_TICKETS);
    const failed = buildPartnerPage({ partner: unavailablePartners(null, "technical")[0]!, phase: "open", windowKey: "2026-09", failure: QUERY_FAILED, role: "technical" });
    const html = renderToStaticMarkup(<PartnerPageView view={failed} backtest={null} />);
    expect(html).toContain(QUERY_FAILED);
    expect(failed.tiles.every((tile) => tile.value === "Unavailable")).toBe(true);
    expect(html).not.toContain(">0<");
    expect(html.match(/>Unavailable</g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(html).toContain(ROW_UNAVAILABLE);
    expect(html).toMatch(/class="[^"]*text-danger[^"]*">Unavailable\. This is not zero downtime\./);
    expect(html).not.toContain("UPTIME · MONTHLY");
    expect(html).not.toContain("<details");
    const header = html.slice(0, html.indexOf("</header>"));
    for (const text of ["Tracking only", "Meeting", "At risk", "Breached"]) expect(header).not.toContain(text);
  });

  it("says no downtime was recorded, with no table, for a partner without terms or tracking rows", () => {
    const view = buildPartnerPage({ partner: technical([scoredRow()], "kabam"), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    expect(view.terms).toEqual([]);
    expect(view.tracking).toEqual([]);
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).toContain(NO_DOWNTIME);
    expect(html).toContain(TRACKING_ONLY_NOTE);
    expect(html).not.toContain("<table");
  });

  it("shows a true zero for a partner with no downtime, distinct from the unavailable state", () => {
    const idle = buildPartnerPage({ partner: technical([scoredRow()], "niantic"), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    const idleDowntime = idle.tiles.find((tile) => tile.label === "Downtime this window");
    expect(idleDowntime?.value).toBe("0 min");
    const failed = buildPartnerPage({ partner: unavailablePartners(null, "technical")[0]!, phase: "open", windowKey: "2026-09", failure: QUERY_FAILED, role: "technical" });
    const failedDowntime = failed.tiles.find((tile) => tile.label === "Downtime this window");
    expect(failedDowntime?.value).toBe("Unavailable");
    expect(failedDowntime?.value).not.toBe(idleDowntime?.value);
    const tracked = buildPartnerPage({ partner: technical([trackingRow({ partner: "niantic", usedMinutes: 42 })], "niantic"), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    expect(tracked.tiles.map((tile) => tile.value)).toEqual([NO_TERMS, NO_TERMS, NO_TERMS, "42 min"]);
  });

  it("renders a bound partner's historical replay without turning no-exposure months into zeros", () => {
    const view = buildPartnerPage({ partner: technical([scoredRow()]), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    const report = {
      range: { description: "as far back as data exists", from: "2026-01-01", through: "2026-03-31" },
      partners: [
        {
          months: [
            { month: "2026-01", exposure: false, scopes: [] },
            {
              month: "2026-03",
              exposure: true,
              scopes: [{ scopeId: "payments", steps: 17, rules: { breaching: 2, trend: 3, level: 4, meeting: 8 } }],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={toBacktestPanel(report)} />);
    expect(html).toContain("as far back as data exists: 2026-01-01 through 2026-03-31");
    expect(html).toContain("No exposure");
    expect(html).toContain("March 2026");
    expect(html).toContain(">2<");
    expect(html).toContain(">8<");
    const replay = html.slice(html.indexOf("Historical replay"));
    const january = replay.slice(replay.indexOf("January 2026"), replay.indexOf("March 2026", replay.indexOf("January 2026")));
    expect(january).toContain("No exposure");
    expect(january).not.toMatch(/>0</);

    const errorHtml = renderToStaticMarkup(<PartnerPageView view={view} backtest={{ state: "error", message: BACKTEST_FAILED }} />);
    expect(errorHtml).toContain(BACKTEST_FAILED);
    expect(errorHtml).not.toContain("No exposure");
  });

  it("disables Backtest with its tooltip for an unbound tracking-only partner, and offers it for a bound one", () => {
    const tracking = buildPartnerPage({ partner: technical([trackingRow({ partner: "kabam" })], "kabam"), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    expect(tracking.backtest?.enabled).toBe(false);
    const trackingHtml = renderToStaticMarkup(<PartnerPageView view={tracking} backtest={null} />);
    expect(trackingHtml).toMatch(/<button(?=[^>]*aria-label="Backtest Kabam")(?=[^>]*\sdisabled="")[^>]*>/);
    expect(trackingHtml).toContain(BACKTEST_TRACKING_ONLY.replace("'", "&#x27;"));
    expect(trackingHtml).not.toContain('name="backtest"');

    const bound = buildPartnerPage({ partner: technical([scoredRow()]), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    const boundHtml = renderToStaticMarkup(<PartnerPageView view={bound} backtest={null} />);
    expect(boundHtml).toMatch(/<form[^>]*method="get"/);
    expect(boundHtml).toContain('name="backtest"');
    expect(boundHtml).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("shows the settled note and never calls a settled window final", () => {
    const view = buildPartnerPage({ partner: technical([scoredRow()]), phase: "settled", windowKey: "2026-08", failure: null, role: "technical" });
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).toContain(SETTLED_NOTE);
    expect(html.toLowerCase()).not.toContain("final");
  });

  it("renders next tier, prorated window start, a real zero credit, and the filed-against caption", () => {
    const windowStart = "2026-09-15T00:00:00.000Z";
    const view = buildPartnerPage({
      partner: technical([scoredRow({
        status: "breached",
        nextTierStartsAfterMinutes: 216,
        windowStart,
        penalty: {
          incurred: { kind: "credit", creditFraction: 0, amount: null },
          projected: { kind: "credit", creditFraction: 0.05, amount: null },
        },
      })]),
      phase: "open", windowKey: "2026-09", failure: null, role: "technical",
    });
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    const cards = html.slice(html.indexOf("Coverage terms"));
    expect(cards).toContain("Breached");
    expect(cards).toMatch(new RegExp(`Next tier</dt><dd[^>]*>${tierDistanceText(76, 216)}</dd>`));
    expect(cards).toContain(tierDistanceText(76, 216));
    expect(proratedWindowNote(windowStart)).not.toBeNull();
    expect(cards).toMatch(new RegExp(`Window start</dt><dd[^>]*>${proratedWindowNote(windowStart)}</dd>`));
    expect(cards).toMatch(/Credit incurred<\/dt><dd[^>]*>0%<\/dd>/);
    expect(cards).toMatch(/Credit projected<\/dt><dd[^>]*>5%<\/dd>/);
    expect(html).toContain(`>${FILED_AGAINST}</dt>`);
  });
});
