/** @vitest-environment happy-dom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutageLines } from "@/app/dashboard/outage-lines";
import { TermTable } from "@/app/dashboard/term-table";
import { OUTAGE_DISCLOSURE_SCRIPT } from "@/app/dashboard/outage-disclosure";
import { buildTechnicalPartners } from "@/app/dashboard/view";
import type { TechnicalRow } from "@/feed";
import { scoredRow } from "../support/rows";

type Outage = Extract<TechnicalRow, { kind: "scored" }>["outages"][number];

const boundaryOutage: Outage = {
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
};

function termsFor(outages: Outage[], usedMinutes: number) {
  const partner = buildTechnicalPartners([scoredRow({ outages, usedMinutes })], "open", "2026-09", null).find((entry) => entry.id === "scopely");
  if (partner === undefined) throw new Error("missing partner");
  return partner.terms;
}

function press(summary: HTMLElement, key: string) {
  summary.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("term table expander", () => {
  it("toggles from the row, Enter, and Space, and reconciles a boundary outage", () => {
    document.body.innerHTML = renderToStaticMarkup(<TermTable partnerName="Scopely" terms={termsFor([boundaryOutage], 30)} />);
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
    const panel = document.getElementById(summary?.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("GTO-543");
    expect(panel?.textContent).toContain("50 min total · 30 min in this window");
    expect(panel?.textContent).toContain("1 outage · 30 minutes counted in this window");

    press(summary as HTMLElement, "Enter");
    expect(details?.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");

    press(summary as HTMLElement, " ");
    expect(details?.open).toBe(true);
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.textContent).toContain("50 min total · 30 min in this window");
  });

  it("shows the window trend in the expanded panel, and expands a term without outages to the trend only", () => {
    document.body.innerHTML = renderToStaticMarkup(<TermTable partnerName="Scopely" terms={termsFor([boundaryOutage], 30)} />);
    expect(document.querySelector("thead")?.textContent).not.toContain("Window trend");
    const summary = document.querySelector("summary") as HTMLElement;
    expect(summary.querySelector("svg[role='img']")).toBeNull();
    const panel = document.getElementById(summary.getAttribute("aria-controls") ?? "");
    expect(panel?.textContent).toContain("Window trend");
    expect(panel?.querySelector("svg[role='img']")).not.toBeNull();

    const quiet = renderToStaticMarkup(<TermTable partnerName="Scopely" terms={termsFor([], 0)} />);
    expect(quiet).toContain("<details");
    expect(quiet).not.toContain("data-outages");
    expect(quiet).toContain("Window trend");
    expect(quiet).toContain("Show trend for Scopely");
  });

  it("notes overlapping minutes and reconciles the merged total once", () => {
    const merged: Outage[] = [
      { ...boundaryOutage, pirKey: "GTO-700", incidentStarted: "2026-09-05T10:00:00.000Z", minutesInWindow: 40, totalMinutes: 40, mergeGroup: "1", countedMinutes: 30 },
      { ...boundaryOutage, pirKey: "GTO-701", incidentStarted: "2026-09-05T10:20:00.000Z", minutesInWindow: 20, totalMinutes: 20, mergeGroup: "1", countedMinutes: 10 },
    ];
    const html = renderToStaticMarkup(<TermTable partnerName="Scopely" terms={termsFor(merged, 40)} />);
    expect(html).toContain("Overlapping minutes were counted once.");
    expect(html).toContain("2 outages · 40 minutes counted in this window");
  });

  it("renders a meeting status with the success border and text", () => {
    const partner = buildTechnicalPartners(
      [scoredRow({ status: "meeting", usedMinutes: 1 })],
      "open",
      "2026-09",
      { withTerms: new Set(["scopely"]), bound: new Set(["scopely"]), draft: new Set() },
    ).find((entry) => entry.id === "scopely");
    const html = renderToStaticMarkup(<TermTable partnerName="Scopely" terms={partner?.terms ?? []} />);
    expect(html).toMatch(/class="[^"]*border-success[^"]*text-success[^"]*">Meeting</);
  });

  it("renders the PIR key as a link only for an https ticket URL, and the severity without an em dash", () => {
    const linked = termsFor([boundaryOutage], 30)[0]?.outages ?? [];
    expect(linked[0]?.severity).toBe("L1 · Critical");
    const linkedHtml = renderToStaticMarkup(<OutageLines outages={linked} />);
    expect(linkedHtml).toContain('href="https://jira.example/browse/GTO-543"');
    expect(linkedHtml).toContain('rel="noopener noreferrer"');
    expect(linkedHtml).toContain("L1 · Critical");
    expect(linkedHtml).not.toContain("—");
    expect(linkedHtml).toContain("Merchant id");
    expect(linkedHtml).toContain("151639");
    expect(linkedHtml).toContain("ai_approved · jenil_patel · 2026-09-22 21:34:00 UTC");
    expect(linkedHtml).not.toContain("Source");

    const plain = termsFor([{ ...boundaryOutage, pirKey: "GTO-100", pirUrl: null, source: "pipeline" }], 30)[0]?.outages ?? [];
    const plainHtml = renderToStaticMarkup(<OutageLines outages={plain} />);
    expect(plainHtml).toContain("GTO-100");
    expect(plainHtml).toContain("no ticket link");
    expect(plainHtml).not.toContain("<a ");
    expect(plainHtml).toContain("Source");
    expect(plainHtml).toContain("pipeline");

    const insecure = termsFor([{ ...boundaryOutage, pirKey: "GTO-101", pirUrl: "http://jira.example/browse/GTO-101" }], 30)[0]?.outages ?? [];
    expect(insecure[0]?.href).toBeNull();
  });
});
