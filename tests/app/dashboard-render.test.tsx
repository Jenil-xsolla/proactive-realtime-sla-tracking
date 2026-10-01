import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import type { IngestionHealthDetail, SlaFeed, TechnicalRow } from "@/feed";
import {
  INGESTION_FAILED_LABEL,
  INGESTION_HEALTH_UNAVAILABLE,
  INGESTION_UNRESOLVED_LABEL,
  INGESTION_WITHOUT_MESSAGE_LABEL,
  QUERY_FAILED,
  ROW_UNAVAILABLE,
} from "@/app/dashboard/copy";
import {
  buildPartnerGroups,
  buildReadyDashboard,
  buildUnavailableDashboard,
} from "@/app/dashboard/model";
import { OutageLines } from "@/app/dashboard/outage-lines";
import { TechnicalDashboard } from "@/app/dashboard/technical-dashboard";
import { StatusBadge } from "@/ui";

const asOf = new Date("2026-09-23T15:58:00.000Z");

function health(overrides: Partial<SlaFeed["health"]> = {}): SlaFeed["health"] {
  return {
    usableCount: 4,
    unusableCount: 0,
    countsByReason: Object.fromEntries(UNUSABLE_REASONS.map((reason) => [reason, 0])) as SlaFeed["health"]["countsByReason"],
    unresolvedPartnerNames: [],
    unresolvedServiceNames: [],
    partnersWithZeroAttributedRows: ["twitch"],
    ...overrides,
  };
}

function emptyIngestion(): IngestionHealthDetail {
  return {
    status: "ok",
    counts: { failed: 0, unresolved: 0, withoutMessage: 0 },
    failed: [],
    unresolved: [],
    withoutMessage: [],
  };
}

function trackingRow(overrides: Partial<Extract<TechnicalRow, { kind: "tracking_only" }>> = {}): TechnicalRow {
  return {
    kind: "tracking_only",
    partner: "scopely",
    service: "payments",
    usedMinutes: 42,
    incidentCount: 2,
    comparison: {
      kind: "compared",
      coveredMonths: 6,
      monthsWithDowntime: 4,
      currentMinutes: 42,
      medianMinutes: 10,
      versusMedian: "above",
    },
    outages: [
      {
        pirKey: "GTO-543",
        pirUrl: "https://jira.example/browse/GTO-543",
        partnerId: 151639,
        severity: "l1",
        decisionType: "ai_approved",
        reviewedBy: "ada",
        reviewedAt: "2026-09-02T23:55:00.000Z",
        source: null,
        service: "payments",
        incidentStarted: "2026-09-02T23:40:00.000Z",
        minutesInWindow: 20,
        totalMinutes: 20,
        mergeGroup: "1",
        countedMinutes: 20,
      },
    ],
    ...overrides,
  };
}

describe("dashboard model", () => {
  it("shows a true zero for a partner with no downtime and an error as unavailable", () => {
    const ready = buildPartnerGroups([trackingRow()]);
    const idle = ready.find((partner) => partner.id === "niantic");
    expect(idle?.rows[0]).toMatchObject({
      minutes: "0 min",
      incidents: "0",
      comparison: "No downtime recorded in this window.",
      tone: "none",
    });

    const failed = buildUnavailableDashboard({
      asOf,
      windowKey: "2026-09",
      message: QUERY_FAILED,
    });
    const failedRow = failed.partners.find((partner) => partner.id === "niantic")?.rows[0];
    expect(failedRow?.minutes).toBe("Unavailable");
    expect(failedRow?.minutes).not.toBe(idle?.rows[0]?.minutes);
    expect(failedRow?.comparison).toBe(ROW_UNAVAILABLE);
  });

  it("keeps scored fields off the tracking view", () => {
    const scored: TechnicalRow = {
      kind: "scored",
      partner: "scopely",
      scopeId: "scopely-payments",
      target: 0.999,
      allowedMinutes: 43.2,
      usedMinutes: 30,
      remainingMinutes: 13.2,
      burnRate: 2,
      status: "at_risk",
      projectedExhaustion: null,
      penalty: {
        incurred: { kind: "credit", creditFraction: 0.1, amount: null },
        projected: { kind: "credit", creditFraction: 0.1, amount: null },
      },
      reason: {
        rule: "trend",
        fired: ["trend"],
        elapsedFraction: 0.5,
        consumedFraction: 0.8,
        projectedMinutes: 60,
        usedMinutes: 30,
        allowedMinutes: 43.2,
        burnRate: 2,
      },
      outages: [],
    };
    const view = buildPartnerGroups([scored]).find((partner) => partner.id === "scopely");
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("at_risk");
    expect(serialised).not.toContain("penalty");
    expect(serialised).not.toContain("43.2");
    expect(view?.trackingOnly).toBe(false);
    expect(view?.rows[0]?.minutes).toBe("30 min");
  });

  it("links the PIR key to a stored https URL and leaves other keys as text", () => {
    const linked = buildPartnerGroups([trackingRow()]).find((partner) => partner.id === "scopely")
      ?.rows[0]?.outages[0];
    expect(linked?.href).toBe("https://jira.example/browse/GTO-543");
    expect(linked?.review).toBe("ai_approved · ada · 2026-09-02 23:55:00 UTC");
    expect(linked?.severity).toBe("L1 — Critical");

    const plain = buildPartnerGroups([
      trackingRow({
        outages: [
          {
            pirKey: "GTO-100",
            pirUrl: null,
            partnerId: 151639,
            severity: "l2",
            decisionType: "human_corrected",
            reviewedBy: "grace",
            reviewedAt: null,
            source: null,
            service: "login",
            incidentStarted: "2026-08-01T00:00:00.000Z",
            minutesInWindow: 5,
            totalMinutes: 5,
            mergeGroup: "1",
            countedMinutes: 5,
          },
        ],
      }),
    ]).find((partner) => partner.id === "scopely")?.rows[0]?.outages[0];
    expect(plain?.href).toBeNull();

    const insecure = buildPartnerGroups([
      trackingRow({
        outages: [
          {
            pirKey: "GTO-101",
            pirUrl: "http://jira.example/browse/GTO-101",
            partnerId: null,
            severity: "l1",
            decisionType: "ai_approved",
            reviewedBy: "ada",
            reviewedAt: null,
            source: null,
            service: "payments",
            incidentStarted: "2026-08-02T00:00:00.000Z",
            minutesInWindow: 5,
            totalMinutes: 5,
            mergeGroup: "1",
            countedMinutes: 5,
          },
        ],
      }),
    ]).find((partner) => partner.id === "scopely")?.rows[0]?.outages[0];
    expect(insecure?.href).toBeNull();
  });
});

describe("dashboard render", () => {
  it("shows settled copy, health counts, and a disabled backtest on a tracking-only screen", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2026-08",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health({
          unusableCount: 2,
          unresolvedPartnerNames: ["Unknown Studio"],
          unresolvedServiceNames: ["Not A Service"],
          countsByReason: {
            ...health().countsByReason,
            unresolved_partner: 1,
            unresolved_service: 1,
          },
        }),
        rows: [trackingRow()],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);

    expect(html).toContain("Settled");
    expect(html).toContain("A late PIR can still change this window.");
    expect(html.toLowerCase()).not.toContain("final");
    expect(html).toContain("Dropped rows");
    expect(html).toContain("Unknown Studio");
    expect(html).toContain("Not A Service");
    expect(html).toContain("Twitch");
    expect(html).toContain("Above this partner&#x27;s six-month median of 10 min");
    expect(html).not.toMatch(/At risk|Breaching|Meeting|penalty|budget/i);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Backtest Scopely")(?=[^>]*disabled)[^>]*>/);
    expect(html).toContain("Tracking-only partners have no terms to replay.");
    expect(html).toContain('href="https://jira.example/browse/GTO-543"');
    expect(html).not.toContain("atlassian.net");
    expect(html).toContain(INGESTION_FAILED_LABEL);
    expect(html).toContain(INGESTION_UNRESOLVED_LABEL);
    expect(html).toContain(INGESTION_WITHOUT_MESSAGE_LABEL);
  });

  it("renders each ingestion list with a linked key, and 'None' when a list is empty", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2026-08",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [trackingRow()],
        invalidTerms: [],
        ingestion: {
          status: "ok",
          counts: { failed: 2, unresolved: 1, withoutMessage: 1 },
          failed: [
            {
              pirKey: "GTO-900",
              pirUrl: "https://jira.example/browse/GTO-900",
              error: "Jira fetch failed",
              updatedAt: "2026-09-20T00:00:00.000Z",
            },
            {
              pirKey: "GTO-901",
              pirUrl: null,
              error: "Missing incident link",
              updatedAt: "2026-09-19T00:00:00.000Z",
            },
          ],
          unresolved: [
            {
              pirKey: "GTO-902",
              pirUrl: "https://jira.example/browse/GTO-902",
              values: [{ kind: "merchant", raw: "Some Unmatched Studio LLC" }],
            },
          ],
          withoutMessage: [],
        },
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);

    expect(html).toContain("Failed PIRs");
    expect(html).toContain('href="https://jira.example/browse/GTO-900"');
    expect(html).toContain(">GTO-900<");
    expect(html).toContain("Jira fetch failed");
    expect(html).toContain(">GTO-901<");
    expect(html).toContain("Missing incident link");
    expect(html).not.toMatch(/<a[^>]*>GTO-901<\/a>/);
    expect(html).toContain(">GTO-902<");
    expect(html).toContain("Some Unmatched Studio LLC");
    expect(html).toContain("None");
  });

  it("shows an explicit error state for ingestion health, never a zero", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2026-08",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [trackingRow()],
        invalidTerms: [],
        ingestion: { status: "error" },
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);

    expect(html).toContain(INGESTION_HEALTH_UNAVAILABLE);
    expect(html).not.toContain(INGESTION_FAILED_LABEL);
    expect(html).not.toContain(INGESTION_UNRESOLVED_LABEL);
    expect(html).not.toContain(INGESTION_WITHOUT_MESSAGE_LABEL);
  });

  it("does not render a zero when the query failed", () => {
    const model = buildUnavailableDashboard({
      asOf,
      windowKey: "2026-09",
      message: QUERY_FAILED,
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);
    expect(html).toContain("Unavailable");
    expect(html).toContain("This is not zero downtime.");
    expect(html).toContain("This is not a clean extract.");
    expect(html).not.toContain(">0 min<");
    expect(html).not.toContain(">0<");
    expect(html).not.toContain("No rows dropped");
  });

  it("renders the PIR key as the https link and plain text when there is no ticket URL", () => {
    const linked = buildPartnerGroups([trackingRow()]).find((partner) => partner.id === "scopely")
      ?.rows[0];
    const linkedHtml = renderToStaticMarkup(<OutageLines outages={linked?.outages ?? []} />);
    expect(linkedHtml).toContain('href="https://jira.example/browse/GTO-543"');
    expect(linkedHtml).toContain('rel="noopener noreferrer"');
    expect(linkedHtml).toContain(">GTO-543<");
    expect(linkedHtml).toContain("ai_approved · ada · 2026-09-02 23:55:00 UTC");
    expect(linkedHtml).toContain("Merchant id");
    expect(linkedHtml).toContain("151639");
    expect(linkedHtml).not.toContain("Source");
    expect(linkedHtml).not.toContain("atlassian.net");

    const plain = buildPartnerGroups([
      trackingRow({
        usedMinutes: 5,
        incidentCount: 1,
        outages: [
          {
            pirKey: "GTO-100",
            pirUrl: null,
            partnerId: 151639,
            severity: "l2",
            decisionType: "human_corrected",
            reviewedBy: "grace",
            reviewedAt: null,
            source: null,
            service: "login",
            incidentStarted: "2026-08-01T00:00:00.000Z",
            minutesInWindow: 5,
            totalMinutes: 5,
            mergeGroup: "1",
            countedMinutes: 5,
          },
        ],
      }),
    ]).find((partner) => partner.id === "scopely")?.rows[0];
    const plainHtml = renderToStaticMarkup(<OutageLines outages={plain?.outages ?? []} />);
    expect(plainHtml).toContain("GTO-100");
    expect(plainHtml).toContain("no ticket link");
    expect(plainHtml).not.toContain("<a ");
  });

  it("shows both durations for a boundary outage and reconciles to the row total", () => {
    const row = buildPartnerGroups([
      trackingRow({
        usedMinutes: 30,
        incidentCount: 1,
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
      }),
    ]).find((partner) => partner.id === "scopely")?.rows[0];
    expect(row?.minutes).toBe("30 min");
    expect(row?.reconciliation).toBe("1 outage · 30 minutes counted in this window");
    const html = renderToStaticMarkup(<OutageLines outages={row?.outages ?? []} />);
    expect(html).toContain("50 min total · 30 min in this window");
    expect(html).toContain("computed");
    expect(html).toContain("1 outage · 30 minutes counted in this window");
    expect(html).toContain("ai_approved · jenil_patel · 2026-09-22 21:34:00 UTC");
  });

  it("groups merged outages and counts their overlap once", () => {
    const row = buildPartnerGroups([
      trackingRow({
        usedMinutes: 140,
        incidentCount: 2,
        outages: [
          {
            pirKey: "PIR-B",
            pirUrl: "https://jira.example/browse/PIR-B",
            partnerId: 151639,
            severity: "l1",
            decisionType: "ai_approved",
            reviewedBy: "jenil_patel",
            reviewedAt: null,
            source: null,
            service: "payments",
            incidentStarted: "2026-08-10T00:40:00.000Z",
            minutesInWindow: 100,
            totalMinutes: 100,
            mergeGroup: "1",
            countedMinutes: 40,
          },
          {
            pirKey: "PIR-A",
            pirUrl: null,
            partnerId: 151639,
            severity: "l1",
            decisionType: "ai_approved",
            reviewedBy: "jenil_patel",
            reviewedAt: null,
            source: "pipeline",
            service: "payments",
            incidentStarted: "2026-08-10T00:00:00.000Z",
            minutesInWindow: 100,
            totalMinutes: 100,
            mergeGroup: "1",
            countedMinutes: 100,
          },
        ],
      }),
    ]).find((partner) => partner.id === "scopely")?.rows[0];
    expect(row?.minutes).toBe("140 min");
    expect(row?.outages.map((outage) => outage.pirKey)).toEqual(["PIR-B", "PIR-A"]);
    expect(row?.reconciliation).toBe("2 outages · 140 minutes counted in this window");
    const html = renderToStaticMarkup(<OutageLines outages={row?.outages ?? []} />);
    expect(html).toContain("Overlapping minutes were counted once.");
    expect(html).toContain("Source");
    expect(html).toContain("pipeline");
    expect(html).toContain("2 outages · 140 minutes counted in this window");
  });

  it("prints a text label on warning and danger badges", () => {
    expect(renderToStaticMarkup(<StatusBadge variant="warning" label="At risk" />)).toContain("At risk");
    expect(renderToStaticMarkup(<StatusBadge variant="danger" label="Breaching" />)).toContain("Breaching");
  });
});
