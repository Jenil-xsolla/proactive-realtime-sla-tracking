import { describe, expect, it } from "vitest";
import type { BusinessRow, TechnicalRow } from "@/feed";
import { buildBusinessPartners, buildTechnicalPartners, buildTrend, unavailablePartners, worstStatus } from "@/app/dashboard/view";
import { CLAUSE_NOT_RECORDED, NO_TICKETS, TREND_NA } from "@/app/dashboard/copy";
import { businessScoredRow, history, scoredRow } from "../support/rows";

describe("view model", () => {
  it("builds a technical term with linked tickets, outages, clause, and a trend", () => {
    const [scopely] = buildTechnicalPartners([scoredRow()], "open", "2026-09", null);
    expect(scopely?.id).toBe("scopely");
    expect(scopely?.worst).toBe("breaching");
    const term = scopely?.terms[0];
    expect(term).toMatchObject({
      title: "Payments",
      target: "99.950%",
      actual: "99.648%",
      actualCaption: "to date",
      consumedPercent: "351.9% consumed",
      downLine: "76.0 / 21.6 min down",
      credit: { incurred: "5%", projected: "10%", text: "5% → 10%" },
      clause: { text: CLAUSE_NOT_RECORDED, missing: true },
    });
    expect(term?.tickets).toEqual([
      { key: "GTO-601", href: null },
      { key: "GTO-600", href: "https://jira.example/browse/GTO-600" },
    ]);
    expect(term?.outages).toHaveLength(2);
    expect(term?.trend.bars).toHaveLength(7);
    expect(term?.trend.bars[0]).toEqual({ month: "2026-03", label: "March 2026", minutes: null, current: false });
    expect(term?.trend.bars[6]).toEqual({ month: "2026-09", label: "September 2026", minutes: 76, current: true });
    expect(term?.trend.text).toBe("above median");
  });

  it("builds the same term from a business row without engineer-only material", () => {
    const [scopely] = buildBusinessPartners([businessScoredRow()], "open", "2026-09");
    const term = scopely?.terms[0];
    expect(scopely?.merchantIds).toBeNull();
    expect(scopely?.contractTerms).toBeNull();
    expect(term?.clause).toBeNull();
    expect(term?.tickets).toBeNull();
    expect(term?.outages).toBeNull();
    expect(term).toMatchObject({ title: "Payments", status: "at_risk", actual: "99.915%", credit: { text: "0% → 5%" } });
    expect(term?.sentence).toBe("At the current pace, downtime will exhaust the allowance before the window closes.");
    expect(JSON.stringify(scopely)).not.toContain("GTO-");
  });

  it("lists every pilot partner, marks tracking-only ones, and keeps unavailable distinct from zero", () => {
    const partners = buildTechnicalPartners([scoredRow()], "open", "2026-09", { withTerms: new Set(["scopely", "kabam"]), bound: new Set(["scopely"]), draft: new Set(["kabam"]) });
    expect(partners).toHaveLength(11);
    const kabam = partners.find((partner) => partner.id === "kabam");
    expect(kabam).toMatchObject({ trackingOnly: true, worst: null, contractTerms: "draft", terms: [], tracking: [] });
    const failed = unavailablePartners(null, "technical");
    expect(failed[0]).toMatchObject({ unavailable: true, contractTerms: "unknown", terms: [], tracking: [] });
  });

  it("renders a trend with n/a when there is no comparison", () => {
    const trend = buildTrend(history, "2026-09", 5, null);
    expect(trend.mark).toBe("none");
    expect(trend.text).toBe(TREND_NA);
    expect(trend.summary).toContain("September 2026: 5.0 min");
  });

  it("lists one ticket per PIR when a multi-service scope has one outage row per service", () => {
    const base = (scoredRow() as Extract<TechnicalRow, { kind: "scored" }>).outages[0]!;
    const shared = { ...base, pirKey: "GTO-700", pirUrl: "https://jira.example/browse/GTO-700" };
    const [scopely] = buildTechnicalPartners(
      [
        scoredRow({
          services: ["payments", "login"],
          outages: [
            { ...shared, service: "payments", incidentStarted: "2026-09-12T10:00:00.000Z", mergeGroup: "1" },
            { ...shared, service: "login", incidentStarted: "2026-09-12T10:00:00.000Z", mergeGroup: "2" },
            { ...shared, pirKey: "GTO-701", pirUrl: null, service: "payments", incidentStarted: "2026-09-03T10:00:00.000Z", mergeGroup: "3" },
          ],
        }),
      ],
      "open",
      "2026-09",
      null,
    );
    const term = scopely?.terms[0];
    expect(term?.outages).toHaveLength(3);
    expect(term?.tickets).toEqual([
      { key: "GTO-700", href: "https://jira.example/browse/GTO-700" },
      { key: "GTO-701", href: null },
    ]);
  });

  it("reports the empty tickets sentence for a term with no outages", () => {
    const [scopely] = buildTechnicalPartners([scoredRow({ outages: [], usedMinutes: 0 })], "open", "2026-09", null);
    expect(scopely?.terms[0]?.tickets).toEqual([]);
    expect(NO_TICKETS).toBe("No outages in this window.");
  });

  it("picks the worst status", () => {
    expect(worstStatus(["meeting", "at_risk"])).toBe("at_risk");
    expect(worstStatus(["breaching", "meeting"])).toBe("breaching");
    expect(worstStatus([])).toBeNull();
  });
  it("computes settled uptime over the full window and drops the to-date caption", () => {
    const [technical] = buildTechnicalPartners([scoredRow()], "settled", "2026-09", null);
    expect(technical?.terms[0]).toMatchObject({ actual: "99.824%", actualCaption: null });
    const [business] = buildBusinessPartners([businessScoredRow()], "settled", "2026-09");
    expect(business?.terms[0]).toMatchObject({ actual: "99.957%", actualCaption: null });
  });

  it("builds tracking-only rows for both roles, with outages only for the technical role", () => {
    const technicalRow: TechnicalRow = {
      kind: "tracking_only",
      partner: "scopely",
      service: "payments",
      usedMinutes: 26,
      incidentCount: 1,
      comparison: { kind: "insufficient_history", coveredMonths: 2, monthsWithDowntime: 1 },
      history,
      outages: [
        {
          pirKey: "GTO-700", pirUrl: null, partnerId: 151639, severity: "l2",
          decisionType: "system_written", reviewedBy: null, reviewedAt: null, source: "pipeline", service: "payments",
          incidentStarted: "2026-09-12T10:00:00.000Z", minutesInWindow: 26, totalMinutes: 26, mergeGroup: "1", countedMinutes: 26,
        },
      ],
    };
    const [technical] = buildTechnicalPartners([technicalRow], "open", "2026-09", null);
    expect(technical).toMatchObject({ trackingOnly: true, worst: null, terms: [] });
    expect(technical?.tracking[0]).toMatchObject({
      key: "scopely:tracking:payments",
      service: "Payments",
      minutes: "26 min",
      incidents: "1",
      outageCount: 1,
      comparison: "Not enough history to compare yet.",
      trend: { mark: "none", text: TREND_NA },
    });
    expect(technical?.tracking[0]?.outages).toHaveLength(1);

    const businessRow: BusinessRow = {
      kind: "tracking_only",
      partner: "Scopely",
      partnerId: "scopely",
      service: "Payments",
      usedMinutes: 26,
      incidentCount: 2,
      comparison: "Above this partner's six-month median of 12.0 min",
      history,
      versusMedian: "above",
    };
    const [business] = buildBusinessPartners([businessRow], "open", "2026-09");
    expect(business).toMatchObject({ trackingOnly: true, worst: null, terms: [] });
    expect(business?.tracking[0]).toMatchObject({
      key: "scopely:tracking:Payments",
      service: "Payments",
      minutes: "26 min",
      incidents: "2",
      outageCount: 2,
      comparison: "Above this partner's six-month median of 12.0 min",
      outages: null,
      reconciliation: "",
      trend: { mark: "up", text: "above median" },
    });
  });

  it("renders business credit for the none and unknown kinds as the feed's own statements", () => {
    const row = businessScoredRow();
    if (row.kind !== "scored") throw new Error("fixture must be scored");
    const [none] = buildBusinessPartners(
      [{ ...row, creditPercentage: { incurred: { kind: "none", statement: "no penalty clause" }, projected: { kind: "none", statement: "no penalty clause" } } }],
      "open",
      "2026-09",
    );
    expect(none?.terms[0]?.credit).toEqual({
      incurred: "no penalty clause",
      projected: "no penalty clause",
      text: "no penalty clause",
    });
    const [unknown] = buildBusinessPartners(
      [{ ...row, creditPercentage: { incurred: { kind: "unknown", statement: "penalty clause, not yet entered" }, projected: { kind: "unknown", statement: "penalty clause, not yet entered" } } }],
      "open",
      "2026-09",
    );
    expect(unknown?.terms[0]?.credit.incurred).toBe("penalty clause, not yet entered");
    expect(unknown?.terms[0]?.credit.projected).toBe("penalty clause, not yet entered");
  });

  it("appends a partner the registry does not know after the pilots, named by its id", () => {
    const partners = buildTechnicalPartners([scoredRow({ partner: "acme" })], "open", "2026-09", null);
    expect(partners).toHaveLength(12);
    expect(partners[11]).toMatchObject({ id: "acme", name: "acme", trackingOnly: false });
    expect(partners[11]?.terms).toHaveLength(1);
    expect(partners.slice(0, 11).every((partner) => partner.id !== "acme")).toBe(true);
  });

  it("keeps the business role boundary when the feed is unavailable", () => {
    const failed = unavailablePartners(null, "business");
    expect(failed).toHaveLength(11);
    for (const partner of failed) {
      expect(partner).toMatchObject({ unavailable: true, merchantIds: null, contractTerms: null, terms: [], tracking: [], backtestEnabled: false });
    }
  });

  it("links a PIR key only when the stored ticket URL is https", () => {
    const outage = (pirKey: string, pirUrl: string | null) => ({ ...scoredRow().outages[0]!, pirKey, pirUrl });
    const [partner] = buildTechnicalPartners(
      [scoredRow({ outages: [outage("GTO-1", "https://jira.example/browse/GTO-1"), outage("GTO-2", "http://jira.example/browse/GTO-2"), outage("GTO-3", null)] })],
      "open", "2026-09", null,
    );
    const hrefs = Object.fromEntries((partner?.terms[0]?.tickets ?? []).map((ticket) => [ticket.key, ticket.href]));
    expect(hrefs).toEqual({ "GTO-1": "https://jira.example/browse/GTO-1", "GTO-2": null, "GTO-3": null });
  });
});
