import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_ATTENTION, QUERY_FAILED, SETTLED_NOTE } from "@/app/dashboard/copy";
import { buildOverview } from "@/app/dashboard/overview";
import { OverviewPage } from "@/app/dashboard/overview-page";
import { buildBusinessPartners, buildTechnicalPartners, unavailablePartners } from "@/app/dashboard/view";
import type { TechnicalRow } from "@/feed";
import { businessScoredRow, scoredRow } from "../support/rows";

function partnersWith(rows: TechnicalRow[]) {
  return buildTechnicalPartners(rows, "open", "2026-09", { withTerms: new Set(["scopely", "niantic"]), bound: new Set(["scopely", "niantic"]), draft: new Set() });
}

describe("overview", () => {
  it("counts terms by status, lists at-risk and breaching terms breaching first, and sorts the rail worst first", () => {
    const view = buildOverview({
      partners: partnersWith([
        scoredRow({ partner: "niantic", scopeId: "payments", status: "at_risk", usedMinutes: 18, penalty: { incurred: { kind: "none", statement: "no penalty clause" }, projected: { kind: "unknown", statement: "penalty clause, not yet entered" } } }),
        scoredRow({ partner: "scopely", scopeId: "payments", status: "breached", usedMinutes: 76 }),
        scoredRow({ partner: "scopely", scopeId: "login", status: "meeting", usedMinutes: 1, services: ["login"] }),
      ]),
      phase: "settled",
      windowKey: "2026-09",
      failure: null,
      role: "technical",
    });
    expect(view.summary).toBe("Monitoring 3 SLA terms across 2 partners · 9 partners tracking only.");
    expect(view.tiles.map((tile) => `${tile.label}=${tile.value}`)).toEqual(["Breached=1", "At risk=1", "Meeting=1", "Tracking only=9"]);
    expect(view.tiles[0]?.emphasis).toBe(true);
    expect(view.attention.map((row) => `${row.partnerId}:${row.term.status}`)).toEqual(["scopely:breached", "niantic:at_risk"]);
    expect(view.attention[1]?.term.credit.text).toBe("no penalty clause → penalty clause, not yet entered");
    expect(view.rail[0]?.id).toBe("scopely");
    expect(view.rail[1]?.id).toBe("niantic");
    expect(view.rail[2]?.termsLink).toEqual({ label: "Add contract terms", href: "/partners/kabam/terms" });
    expect(view.settledNote).toBe(SETTLED_NOTE);
    expect(view.rail.find((card) => card.id === "scopely")?.line).toBe("2 terms · 2 outages · 77.0 min");
    expect(view.rail.find((card) => card.id === "niantic")?.line).toBe("1 term · 2 outages · 18.0 min");
    expect(view.rail.find((card) => card.id === "kabam")?.line).toBe("0 services · 0 outages · 0.0 min recorded");

    const html = renderToStaticMarkup(<OverviewPage view={view} />);
    expect(html).toMatch(/class="[^"]*text-danger[^"]*">Breached</);
    expect(html).toMatch(/class="[^"]*text-warning[^"]*">At risk</);
    expect(html).toMatch(/class="[^"]*text-success[^"]*">Meeting</);
    expect(html).toMatch(/class="[^"]*border-danger[^"]*"/);
    expect(html).toContain("99.950% / ");
    expect(html).toContain("351.9% consumed");
    expect(html).toContain('href="/partners/scopely?window=2026-09"');
    expect(html).not.toContain("—");
  });

  it("renders the empty sentence, not an empty table, when nothing needs attention", () => {
    const view = buildOverview({ partners: partnersWith([]), phase: "open", windowKey: "2026-09", failure: null, role: "technical" });
    expect(view.attention).toEqual([]);
    const html = renderToStaticMarkup(<OverviewPage view={view} />);
    expect(html).toContain(NO_ATTENTION);
    expect(html).not.toContain("<table");
  });

  it("renders Unavailable tiles and error rows when the feed failed, never zeros", () => {
    const view = buildOverview({ partners: unavailablePartners(null, "technical"), phase: "open", windowKey: "2026-09", failure: QUERY_FAILED, role: "technical" });
    expect(view.tiles.every((tile) => tile.value === "Unavailable")).toBe(true);
    expect(view.summary).toBe("");
    const html = renderToStaticMarkup(<OverviewPage view={view} />);
    expect(html).toContain(QUERY_FAILED);
    expect(html).not.toContain("No terms");
    expect(html).not.toContain("Monitoring");
    expect(view.rail).toHaveLength(11);
    expect(view.rail.every((card) => card.unavailable)).toBe(true);
    // One alert for the header, one for the attention slot, and one per rail card.
    expect(html.match(/role="alert"/g)).toHaveLength(13);
    expect(html).not.toContain("Tracking only</span>");
    expect(html).not.toContain("flagged");
    expect(html).not.toContain(">0<");
  });

  it("omits the outages segment from a business rail line, since business terms carry no outage count", () => {
    const partners = buildBusinessPartners([businessScoredRow()], "open", "2026-09");
    const view = buildOverview({ partners, phase: "open", windowKey: "2026-09", failure: null, role: "business" });
    const line = view.rail.find((card) => card.id === "scopely")?.line;
    expect(line).toBe("1 term · 18.4 min");
    expect(line).not.toContain("outages");
    expect(line).not.toContain("outage");
  });

  it("keeps incurred and projected credit apart, and never prints 0% for an unentered clause", () => {
    const numeric = buildOverview({
      partners: partnersWith([
        scoredRow({
          status: "at_risk",
          penalty: {
            incurred: { kind: "credit", creditFraction: 0.1, amount: { amount: 1000, currency: "XXX" } },
            projected: { kind: "credit", creditFraction: 0.25, amount: { amount: 2500, currency: "XXX" } },
          },
        }),
      ]),
      phase: "open", windowKey: "2026-09", failure: null, role: "technical",
    });
    const numericHtml = renderToStaticMarkup(<OverviewPage view={numeric} />);
    expect(numericHtml).toContain("10% · 1,000 XXX → 25% · 2,500 XXX");
    expect(numericHtml).not.toContain("35%");
    expect(numericHtml).not.toContain("3,500");

    const unknown = { kind: "unknown", statement: "penalty clause, not yet entered" } as const;
    const entered = buildOverview({
      partners: partnersWith([scoredRow({ status: "at_risk", penalty: { incurred: unknown, projected: unknown } })]),
      phase: "open", windowKey: "2026-09", failure: null, role: "technical",
    });
    expect(entered.attention[0]?.term.credit.text).toBe("penalty clause, not yet entered");
    const enteredHtml = renderToStaticMarkup(<OverviewPage view={entered} />);
    expect(enteredHtml).toContain("penalty clause, not yet entered");
    expect(enteredHtml).not.toContain("→");
    expect(enteredHtml).not.toMatch(/>0%</);
  });
});
