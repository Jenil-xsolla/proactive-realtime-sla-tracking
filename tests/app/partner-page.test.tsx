import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLAUSE_NOT_RECORDED, CONTRACT_ON_FILE, NO_DOWNTIME, NO_TERMS, NO_TICKETS, OUTSIDE_SCOPES, QUERY_FAILED, ROW_UNAVAILABLE, TRACKING_ONLY_NOTE } from "@/app/dashboard/copy";
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
      "Covered services=1", "At risk=1 / 1", "Breaching=1", "Downtime this window=76 min",
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

  it("renders the business variant without merchant id, backtest, tickets, clause, or expanders", () => {
    const partner = buildBusinessPartners([businessScoredRow()], "open", "2026-09").find((entry) => entry.id === "scopely");
    const view = buildPartnerPage({ partner: partner!, phase: "open", windowKey: "2026-09", failure: null, role: "business" });
    expect(view.meta).toEqual(["1 term", "Monthly window"]);
    expect(view.backtest).toBeNull();
    expect(view.termsLink).toBeNull();
    expect(view.tiles.map((tile) => `${tile.label}=${tile.value}`)).toEqual([
      "Covered services=1", "At risk=1 / 1", "Breaching=0", "Downtime this window=18.4 min",
    ]);
    expect(view.tiles[0]?.detail).toBeNull();
    const html = renderToStaticMarkup(<PartnerPageView view={view} backtest={null} />);
    expect(html).not.toContain("151639");
    expect(html).not.toContain("<details");
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
    for (const text of ["Tracking only", "Meeting", "At risk", "Breaching"]) expect(header).not.toContain(text);
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
});
