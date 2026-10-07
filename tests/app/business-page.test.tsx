import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNav } from "@/app/dashboard/nav";
import { buildOverview } from "@/app/dashboard/overview";
import { OverviewPage } from "@/app/dashboard/overview-page";
import { buildPartnerPage } from "@/app/dashboard/partner-page";
import { PartnerPageView } from "@/app/dashboard/partner-page-view";
import { buildBusinessPartners } from "@/app/dashboard/view";
import { Shell } from "@/app/shell/shell";
import { businessScoredRow, businessTrackingRow } from "../support/rows";

// The outage expander is the only <details> that must never reach a business viewer; the month picker is one by design.
const SENTINELS = ["GTO-", "151639", "ada", "L1", "FIXTURE", "/alerts", "/health", "/terms", "<details data-outages"];

describe("business role", () => {
  it("renders the overview and partner page from business rows with nothing engineer-side in the markup", () => {
    const partners = buildBusinessPartners([businessScoredRow(), businessTrackingRow()], "open", "2026-09");
    const nav = buildNav({ windowKey: "2026-09", role: "business", partners, alerts: null, health: null, active: { kind: "overview" } });
    const frame = { windowKey: "2026-09", windowTitle: "September 2026", phase: "open" as const, months: [], asOfLabel: "2026-09-23 15:58:00 UTC", chip: { label: "No rows dropped", tone: "neutral" as const, href: null } };
    const overview = renderToStaticMarkup(
      <Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview" }]}>
        <OverviewPage view={buildOverview({ partners, phase: "open", windowKey: "2026-09", failure: null, role: "business" })} />
      </Shell>,
    );
    const scopely = partners.find((partner) => partner.id === "scopely")!;
    const page = renderToStaticMarkup(
      <Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview", href: "/?window=2026-09" }, { label: "Scopely" }]}>
        <PartnerPageView view={buildPartnerPage({ partner: scopely, phase: "open", windowKey: "2026-09", failure: null, role: "business" })} backtest={null} />
      </Shell>,
    );
    for (const sentinel of SENTINELS) {
      expect(overview, sentinel).not.toContain(sentinel);
      expect(page, sentinel).not.toContain(sentinel);
    }
    expect(page).toContain("Target uptime");
    expect(page).toContain("Window trend");
    expect(page).toContain("At the current pace");
  });
});
