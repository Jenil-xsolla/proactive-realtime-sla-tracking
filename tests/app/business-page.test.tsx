import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNav } from "@/app/dashboard/nav";
import { buildOverview } from "@/app/dashboard/overview";
import { OverviewPage } from "@/app/dashboard/overview-page";
import { buildPartnerPage } from "@/app/dashboard/partner-page";
import { PartnerPageView } from "@/app/dashboard/partner-page-view";
import { buildBusinessPartners } from "@/app/dashboard/view";
import { Shell } from "@/app/shell/shell";
import { WINDOW_KEY, evaluateBusinessFeed, scoredOutage, trackingOutage } from "../support/business-feed";

// The outage expander is the only <details> that must never reach a business viewer; the month picker is one by design.
const SENTINELS = ["GTO-", "151639", "503608", "ada", "L1", "FIXTURE", "/alerts", "/health", "/terms", "<details data-outages"];

describe("business role", () => {
  it("renders the overview and partner page from a real business evaluation with nothing engineer-side in the markup", async () => {
    const feed = await evaluateBusinessFeed([scoredOutage(), trackingOutage()]);
    if (feed.role !== "business") throw new Error("expected a business feed");
    // The sentinels only mean something if the evaluation really produced both row kinds.
    expect(feed.rows.some((row) => row.kind === "scored" && row.partnerId === "scopely")).toBe(true);
    expect(feed.rows.some((row) => row.kind === "tracking_only")).toBe(true);

    const partners = buildBusinessPartners(feed.rows, "open", WINDOW_KEY);
    const nav = buildNav({ windowKey: WINDOW_KEY, role: "business", partners, alerts: null, health: null, active: { kind: "overview" } });
    const frame = { windowKey: WINDOW_KEY, windowTitle: "April 2026", phase: "open" as const, months: [], asOfLabel: "2026-04-20 00:00:00 UTC", chip: { label: "No rows dropped", tone: "neutral" as const, href: null } };
    const overview = renderToStaticMarkup(
      <Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview" }]}>
        <OverviewPage view={buildOverview({ partners, phase: "open", windowKey: WINDOW_KEY, failure: null, role: "business" })} />
      </Shell>,
    );
    const scopely = partners.find((partner) => partner.id === "scopely")!;
    const page = renderToStaticMarkup(
      <Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview", href: `/?window=${WINDOW_KEY}` }, { label: "Scopely" }]}>
        <PartnerPageView view={buildPartnerPage({ partner: scopely, phase: "open", windowKey: WINDOW_KEY, failure: null, role: "business" })} backtest={null} />
      </Shell>,
    );
    for (const sentinel of SENTINELS) {
      expect(overview, sentinel).not.toContain(sentinel);
      expect(page, sentinel).not.toContain(sentinel);
    }
    expect(page).toContain("Target uptime");
    expect(page).toContain("Window trend");
    expect(overview).toContain("Scopely");
  });
});
