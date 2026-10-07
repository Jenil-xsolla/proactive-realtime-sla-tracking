/** @vitest-environment happy-dom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OUTAGE_DISCLOSURE_SCRIPT } from "@/app/dashboard/outage-disclosure";
import { buildPartnerGroups } from "@/app/dashboard/model";
import { ScopeRow } from "@/app/dashboard/scope-row";
import type { ScopeView } from "@/app/dashboard/model";
import type { TechnicalRow } from "@/feed";

const boundary: TechnicalRow = {
  kind: "tracking_only",
  partner: "scopely",
  service: "payments",
  usedMinutes: 30,
  incidentCount: 1,
  comparison: {
    kind: "no_prior_downtime",
    coveredMonths: 6,
    monthsWithDowntime: 0,
  },
  history: [],
  outages: [
    {
      pirKey: "GTO-543",
      pirUrl: "https://jira.example/browse/GTO-543",
      partnerId: 151639,
      severity: "l1",
      decisionType: "ai_approved",
      reviewedBy: "jenil_patel",
      reviewedAt: "2026-09-22T21:34:00.000Z",
      source: null,
      service: "payments",
      incidentStarted: "2026-08-31T23:40:00.000Z",
      minutesInWindow: 30,
      totalMinutes: 50,
      mergeGroup: "1",
      countedMinutes: 30,
    },
  ],
};

function scopeView(): ScopeView {
  const row = buildPartnerGroups([boundary]).find((partner) => partner.id === "scopely")?.rows[0];
  if (row === undefined) {
    throw new Error("missing scope row");
  }
  return row;
}

function press(summary: HTMLElement, key: string) {
  summary.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("scope row expander", () => {
  it("toggles from the row, Enter, and Space, and reconciles a boundary outage", () => {
    const row = scopeView();
    document.body.innerHTML = renderToStaticMarkup(
      <table>
        <tbody>
          <ScopeRow partnerName="Scopely" row={row} />
        </tbody>
      </table>,
    );
    new Function(OUTAGE_DISCLOSURE_SCRIPT)();

    const summary = document.querySelector("summary");
    const details = document.querySelector("details");
    expect(summary).not.toBeNull();
    expect(summary?.tagName).toBe("SUMMARY");
    expect(summary?.getAttribute("aria-expanded")).toBe("false");
    expect(summary?.getAttribute("aria-controls")).toBeTruthy();
    expect(details?.open).toBe(false);

    summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(details?.open).toBe(true);
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    const panelId = summary?.getAttribute("aria-controls");
    const panel = document.getElementById(panelId ?? "");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("GTO-543");
    expect(panel?.textContent).toContain("50 min total · 30 min in this window");
    expect(panel?.textContent).toContain("1 outage · 30 minutes counted in this window");
    expect(panel?.textContent).toContain(row.minutes);

    press(summary as HTMLElement, "Enter");
    expect(details?.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");

    press(summary as HTMLElement, " ");
    expect(details?.open).toBe(true);
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.textContent).toContain("50 min total · 30 min in this window");
  });
});