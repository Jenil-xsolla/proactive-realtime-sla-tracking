import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import {
  EARLIEST_DATA_MONTH,
  monthKeysThrough,
  resolveDashboardWindow,
  windowPhase,
  type BaselineComparison,
} from "@/feed";
import type { StatusReason } from "@/feed";
import {
  actualUptime,
  alertScopeLabel,
  alertStatusLabel,
  comparisonText,
  consumedText,
  creditText,
  downLine,
  formatMinutes,
  formatUptime,
  penaltyText,
  proratedWindowNote,
  reasonLabel,
  reconciliationText,
  SETTLED_LABEL,
  SETTLED_NOTE,
  statusExplanation,
  ticketHref,
  tierDistanceText,
  trendText,
  truncate,
} from "@/app/dashboard/copy";

describe("dashboard window", () => {
  const asOf = new Date("2026-09-23T15:58:00.000Z");

  it("offers months from the first data month through the current UTC month", () => {
    expect(monthKeysThrough(asOf)[0]).toBe(EARLIEST_DATA_MONTH);
    expect(monthKeysThrough(asOf).at(-1)).toBe("2026-09");
    expect(monthKeysThrough(asOf)).not.toContain("2025-12");
    expect(monthKeysThrough(asOf)).not.toContain("2026-10");
  });

  it("rejects future and pre-data keys", () => {
    expect(resolveDashboardWindow("2026-10", asOf).key).toBe("2026-09");
    expect(resolveDashboardWindow("2025-12", asOf).key).toBe("2026-09");
    expect(resolveDashboardWindow("2026-08", asOf).key).toBe("2026-08");
  });

  it("labels a closed month settled and the current month open", () => {
    const august = resolveDashboardWindow("2026-08", asOf).window;
    const september = resolveDashboardWindow(undefined, asOf).window;
    expect(windowPhase(august, asOf)).toBe("settled");
    expect(windowPhase(september, asOf)).toBe("open");
    expect(SETTLED_LABEL).toBe("Settled");
    expect(SETTLED_NOTE.toLowerCase()).not.toContain("final");
  });
});

describe("dashboard copy", () => {
  it("describes a covered median and refuses a comparison against zero", () => {
    const compared: BaselineComparison = {
      kind: "compared",
      coveredMonths: 6,
      monthsWithDowntime: 4,
      currentMinutes: 42,
      medianMinutes: 12,
      versusMedian: "above",
    };
    const text = comparisonText(compared);
    expect(text).toBe("Above this partner's six-month median of 12 min");
    expect(
      comparisonText({
        kind: "compared",
        coveredMonths: 6,
        monthsWithDowntime: 2,
        currentMinutes: 2,
        medianMinutes: 4,
        versusMedian: "below",
      }),
    ).toBe("Below this partner's six-month median of 4 min");
    expect(
      comparisonText({
        kind: "compared",
        coveredMonths: 4,
        monthsWithDowntime: 3,
        currentMinutes: 8,
        medianMinutes: 8,
        versusMedian: "equal",
      }),
    ).toBe("Equal to this partner's 4-month median of 8 min");
    expect(comparisonText({ kind: "insufficient_history", coveredMonths: 1, monthsWithDowntime: 0 })).toBe(
      "Not enough history to compare yet.",
    );
    expect(comparisonText({ kind: "no_prior_downtime", coveredMonths: 3, monthsWithDowntime: 0 })).toBe(
      "First recorded downtime in the last 3 covered months.",
    );
    expect(text.toLowerCase()).not.toMatch(/\b(worse|better|healthy|unhealthy|good|bad|breach|risk|penalty)\b/);
    expect(comparisonText({ kind: "no_prior_downtime", coveredMonths: 6, monthsWithDowntime: 0 })).not.toContain(
      "median",
    );
  });

  it("keeps an unavailable figure distinct from zero minutes", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(11.52)).toBe("11.52 min");
    expect(formatMinutes(Number.NaN)).toBe("Unavailable");
    expect(formatMinutes(Number.NaN)).not.toBe(formatMinutes(0));
  });

  it("renders a penalty from its kind and keeps incurred off the projected figure", () => {
    expect(penaltyText({ kind: "none", statement: "no penalty clause" })).toBe("no penalty clause");
    expect(penaltyText({ kind: "unknown", statement: "penalty clause, not yet entered" })).toBe(
      "penalty clause, not yet entered",
    );
    expect(penaltyText({ kind: "none", statement: "no penalty clause" })).not.toContain("0%");
    expect(penaltyText({ kind: "unknown", statement: "penalty clause, not yet entered" })).not.toContain("0%");
    expect(penaltyText({ kind: "credit", creditFraction: 0, amount: null })).toBe("0%");
    expect(penaltyText({ kind: "credit", creditFraction: 0.1, amount: { amount: 1000, currency: "XXX" } })).toBe(
      "10% · 1,000 XXX",
    );
    expect(tierDistanceText(18.4, 21.6)).toBe("18.4 of 21.6 min used; the next tier starts after 21.6 min");
  });

  it("builds the status sentence from the reason inputs", () => {
    const reason: StatusReason = {
      rule: "breaching",
      fired: [],
      elapsedFraction: 1,
      consumedFraction: 1.2,
      projectedMinutes: 30,
      usedMinutes: 30,
      allowedMinutes: 21.6,
      burnRate: 1.2,
    };
    expect(statusExplanation(reason)).toBe("Downtime has used 30 min of the 21.6 min allowance for this window.");
    expect(statusExplanation({ ...reason, rule: "meeting", consumedFraction: 0.2, usedMinutes: 4, projectedMinutes: 4 })).toBe(
      "Downtime is within the allowance at this point in the window. 4 min of 21.6 min used.",
    );
  });

  it("notes a mid-month window start and stays quiet when the window opens on the 1st", () => {
    expect(proratedWindowNote("2027-06-15T00:00:00.000Z")).toBe(
      "Starts 2027-06-15. Allowance is prorated to this shorter window.",
    );
    expect(proratedWindowNote("2026-06-01T00:00:00.000Z")).toBeNull();
  });

  it("keeps a stored https ticket URL and rejects anything else", () => {
    expect(ticketHref("https://jira.example/browse/GTO-543")).toBe(
      "https://jira.example/browse/GTO-543",
    );
    expect(ticketHref(null)).toBeNull();
    expect(ticketHref("http://jira.example/browse/GTO-543")).toBeNull();
    expect(ticketHref("javascript:alert(1)")).toBeNull();
  });

  it("counts each merge group once in the reconciliation", () => {
    expect(
      reconciliationText([
        { countedMinutes: 100 },
        { countedMinutes: 40 },
      ]),
    ).toBe("2 outages · 140 minutes counted in this window");
    expect(reconciliationText([{ countedMinutes: 30 }])).toBe(
      "1 outage · 30 minutes counted in this window",
    );
  });

  it("names every unusable reason", () => {
    for (const reason of UNUSABLE_REASONS) {
      expect(reasonLabel(reason)).not.toBe(reason);
    }
  });

  it("truncates by code point, so a surrogate pair is never split in half", () => {
    expect(truncate("😀😀😀", 2)).toBe("😀…");
  });

  it("derives actual uptime to date while open and over the full window once settled", () => {
    expect(actualUptime({ usedMinutes: 21.6, windowMinutes: 43200, elapsedMinutes: 21600, phase: "open" })).toBeCloseTo(1 - 21.6 / 21600, 12);
    expect(actualUptime({ usedMinutes: 21.6, windowMinutes: 43200, elapsedMinutes: 43200, phase: "settled" })).toBeCloseTo(1 - 21.6 / 43200, 12);
    expect(actualUptime({ usedMinutes: 0, windowMinutes: 43200, elapsedMinutes: 0, phase: "open" })).toBe(1);
    expect(formatUptime(0.9995)).toBe("99.950%");
    expect(formatUptime(0.9976)).toBe("99.760%");
  });

  it("writes consumed, down, credit, and trend text in product form", () => {
    expect(consumedText(76, 21.6)).toBe("351.9% consumed");
    expect(consumedText(5, 0)).toBe("Allowance is zero");
    expect(downLine(76, 21.6)).toBe("76.0 / 21.6 min down");
    expect(creditText("0%", "5%")).toBe("0% → 5%");
    expect(trendText("above")).toEqual({ mark: "up", text: "above median" });
    expect(trendText("below")).toEqual({ mark: "down", text: "below median" });
    expect(trendText("equal")).toEqual({ mark: "flat", text: "at median" });
    expect(trendText(null)).toEqual({ mark: "none", text: "n/a" });
  });

  it("labels alert scopes and statuses", () => {
    expect(alertScopeLabel("tracking:login", (id) => id.toUpperCase())).toBe("Service: LOGIN");
    expect(alertScopeLabel("payments", (id) => `title:${id}`)).toBe("title:payments");
    expect(alertStatusLabel("heads_up")).toBe("Heads-up");
    expect(alertStatusLabel("at_risk")).toBe("At risk");
    expect(alertStatusLabel("something_else")).toBe("something_else");
  });

  it("keeps every exported string free of em dashes", async () => {
    const copy = await import("@/app/dashboard/copy");
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value === "string") {
        expect(value, name).not.toContain("—");
      }
    }
  });

  it("keeps status sentences out of components", () => {
    const dirs = ["src/app/dashboard", "src/app/shell"];
    const files = [
      ...dirs.flatMap((dir) =>
        readdirSync(path.join(process.cwd(), dir))
          .filter((name) => name.endsWith(".tsx"))
          .map((name) => path.join(dir, name)),
      ),
      "src/ui/budget-bar.tsx",
      "src/ui/status-badge.tsx",
    ];
    expect(files.length).toBeGreaterThan(10);
    const source = files.map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
    for (const sentence of [
      "Downtime is within",
      "Downtime has used",
      "current pace",
      "Most of the allowance",
      "Most of the downtime",
      "within the allowance",
      "the next tier starts after",
      "no penalty clause",
      "not yet entered",
      "Clause reference not yet recorded",
      "prorated",
    ]) {
      expect(source, sentence).not.toContain(sentence);
    }
  });
});
