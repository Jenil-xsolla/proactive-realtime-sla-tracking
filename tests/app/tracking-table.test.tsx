/** @vitest-environment happy-dom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_UNAVAILABLE, UNAVAILABLE } from "@/app/dashboard/copy";
import { OUTAGE_DISCLOSURE_SCRIPT } from "@/app/dashboard/outage-disclosure";
import { TrackingTable } from "@/app/dashboard/tracking-table";
import { buildTechnicalPartners, buildTrend, type TrackingView } from "@/app/dashboard/view";
import { trackingRow } from "../support/rows";

function rows(): TrackingView[] {
  const partner = buildTechnicalPartners([trackingRow()], "open", "2026-09", null).find((entry) => entry.id === "scopely");
  if (partner === undefined) throw new Error("missing partner");
  return partner.tracking;
}

function press(summary: HTMLElement, key: string) {
  summary.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("tracking table", () => {
  it("expands a tracking row from click and Enter and shows its outage record", () => {
    document.body.innerHTML = renderToStaticMarkup(<TrackingTable partnerName="Scopely" rows={rows()} />);
    new Function(OUTAGE_DISCLOSURE_SCRIPT)();

    const summary = document.querySelector("summary") as HTMLElement;
    const details = document.querySelector("details");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(details?.open).toBe(false);

    summary.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(details?.open).toBe(true);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(summary.getAttribute("aria-controls") ?? "");
    expect(panel?.textContent).toContain("GTO-543");
    expect(panel?.textContent).toContain("1 outage · 20 minutes counted in this window");

    press(summary, "Enter");
    expect(details?.open).toBe(false);
    expect(summary.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a row without outages as a plain, non-expanding row", () => {
    const [row] = rows();
    const html = renderToStaticMarkup(<TrackingTable partnerName="Scopely" rows={[{ ...row!, outages: null }]} />);
    expect(html).not.toContain("<details");
    expect(html).toContain("Payments");
  });

  it("renders the unavailable row in the danger tone, never as zero", () => {
    const row: TrackingView = {
      key: "scopely:unavailable", service: UNAVAILABLE, minutes: UNAVAILABLE, incidents: UNAVAILABLE, usedMinutes: 0, outageCount: 0,
      comparison: ROW_UNAVAILABLE, trend: buildTrend([], "2026-09", 0, null), outages: null, reconciliation: "",
    };
    const html = renderToStaticMarkup(<TrackingTable partnerName="Scopely" rows={[row]} unavailable />);
    expect(html).toContain(ROW_UNAVAILABLE);
    expect(html).toMatch(/text-danger[^>]*>Unavailable</);
    expect(html).toMatch(/text-danger[^>]*>Unavailable\. This is not zero downtime\./);
    expect(html).not.toContain("<details");
    expect(html).not.toContain(">0 min<");
  });
});
