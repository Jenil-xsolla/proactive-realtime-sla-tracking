import { describe, expect, it } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import {
  EARLIEST_DATA_MONTH,
  monthKeysThrough,
  resolveDashboardWindow,
  windowPhase,
  type BaselineComparison,
} from "@/feed";
import {
  comparisonText,
  formatMinutes,
  reasonLabel,
  reconciliationText,
  SETTLED_LABEL,
  SETTLED_NOTE,
  ticketHref,
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
    expect(formatMinutes(Number.NaN)).toBe("Unavailable");
    expect(formatMinutes(Number.NaN)).not.toBe(formatMinutes(0));
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
});
