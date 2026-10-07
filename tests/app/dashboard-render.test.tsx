import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import type { IngestionHealthDetail, SlaFeed, TechnicalRow } from "@/feed";
import {
  BACKTEST_FAILED,
  CLAUSE_NOT_RECORDED,
  FILED_AGAINST,
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
  toBacktestPanel,
} from "@/app/dashboard/model";
import { PartnerTable } from "@/app/dashboard/partner-table";
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

function scoredRow(overrides: Partial<Extract<TechnicalRow, { kind: "scored" }>> = {}): TechnicalRow {
  return {
    kind: "scored",
    partner: "scopely",
    scopeId: "payments",
    target: 0.9995,
    allowedMinutes: 21.6,
    usedMinutes: 18.4,
    remainingMinutes: 3.2,
    burnRate: 1.2,
    status: "at_risk",
    projectedExhaustion: "2026-06-28T00:00:00.000Z",
    windowStart: "2026-06-01T00:00:00.000Z",
    nextTierStartsAfterMinutes: 21.6,
    windowMinutes: 43200,
    elapsedMinutes: 21600,
    history: [],
    comparison: { kind: "insufficient_history", coveredMonths: 0, monthsWithDowntime: 0 },
    sourceClause: "Schedule A, section 4",
    services: ["payments"],
    includesScopedServices: null,
    penalty: {
      incurred: { kind: "credit", creditFraction: 0, amount: null },
      projected: { kind: "credit", creditFraction: 0.05, amount: null },
    },
    reason: {
      rule: "trend",
      fired: ["trend"],
      elapsedFraction: 0.5,
      consumedFraction: 18.4 / 21.6,
      projectedMinutes: 36.8,
      usedMinutes: 18.4,
      allowedMinutes: 21.6,
      burnRate: 1.2,
    },
    outages: [],
    ...overrides,
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
    history: [],
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

  it("names the contracted services and the service an included outage was filed against", () => {
    const groups = buildPartnerGroups([
      scoredRow({
        partner: "second-dinner",
        scopeId: "xsolla-systems",
        services: ["webshop", "igs-bb", "subscriptions", "shop-builder", "payments", "login"],
        usedMinutes: 6,
        outages: [
          {
            pirKey: "POSTMORTEM-466",
            pirUrl: "https://jira.example/browse/POSTMORTEM-466",
            partnerId: 506855,
            severity: "l1",
            decisionType: "ai_approved",
            reviewedBy: "ada",
            reviewedAt: null,
            source: "backfill",
            service: "igs-bb",
            incidentStarted: "2026-04-16T16:46:00.000Z",
            minutesInWindow: 6,
            totalMinutes: 6,
            mergeGroup: "1",
            countedMinutes: 6,
          },
        ],
      }),
    ]);
    const scope = groups.find((partner) => partner.id === "second-dinner")?.rows[0];
    expect(scope?.service).toBe("Webshop, Payments, Login");
    expect(scope?.score?.affected).toBe("Affected: IGS-BB");

    const catchAll = buildPartnerGroups([
      scoredRow({
        partner: "warner-brothers",
        scopeId: "general",
        services: [],
        includesScopedServices: false,
        usedMinutes: 6,
        outages: [
          {
            pirKey: "POSTMORTEM-466",
            pirUrl: null,
            partnerId: 169548,
            severity: "l1",
            decisionType: null,
            reviewedBy: null,
            reviewedAt: null,
            source: "backfill",
            service: "igs-bb",
            incidentStarted: "2026-04-16T16:46:00.000Z",
            minutesInWindow: 6,
            totalMinutes: 6,
            mergeGroup: "1",
            countedMinutes: 6,
          },
        ],
      }),
    ]).find((partner) => partner.id === "warner-brothers")?.rows[0];
    expect(catchAll?.service).toBe("General Scope");
    expect(catchAll?.score?.affected).toBe("Affected: IGS-BB");
  });

  it("keeps a single-service scope from repeating the service as affected", () => {
    const groups = buildPartnerGroups([
      scoredRow({
        outages: [
          {
            pirKey: "GTO-1",
            pirUrl: null,
            partnerId: 151639,
            severity: "l1",
            decisionType: "ai_approved",
            reviewedBy: "ada",
            reviewedAt: null,
            source: "backfill",
            service: "payments",
            incidentStarted: "2026-04-16T16:46:00.000Z",
            minutesInWindow: 6,
            totalMinutes: 6,
            mergeGroup: "1",
            countedMinutes: 6,
          },
        ],
      }),
    ]);
    expect(groups.find((partner) => partner.id === "scopely")?.rows[0]?.score?.affected).toBeNull();
  });

  it("keeps status off partners that are still tracking-only", () => {
    const groups = buildPartnerGroups([scoredRow()]);
    const scored = groups.find((partner) => partner.id === "scopely");
    const idle = groups.find((partner) => partner.id === "niantic");
    expect(scored?.trackingOnly).toBe(false);
    expect(scored?.backtestEnabled).toBe(true);
    expect(scored?.rows[0]?.score?.status).toBe("at_risk");
    expect(scored?.rows[0]?.score?.incurred).toBe("0%");
    expect(scored?.rows[0]?.score?.projected).toBe("5%");
    expect(idle?.rows[0]?.score).toBeNull();
    expect(JSON.stringify(idle)).not.toContain("at_risk");
    expect(JSON.stringify(idle)).not.toContain("penalty");
  });

  it("enables backtest for a bound partner that has no scored row in this window", () => {
    const groups = buildPartnerGroups([], null, new Set(["niantic"]));
    expect(groups.find((partner) => partner.id === "niantic")?.backtestEnabled).toBe(true);
    expect(groups.find((partner) => partner.id === "scopely")?.backtestEnabled).toBe(false);
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
    expect(html).not.toContain("Filed against");
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

  it("renders a scored row in the same table, with incurred and projected kept apart", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2026-06",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({
            penalty: {
              incurred: { kind: "credit", creditFraction: 0.1, amount: { amount: 1000, currency: "XXX" } },
              projected: { kind: "credit", creditFraction: 0.25, amount: { amount: 2500, currency: "XXX" } },
            },
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);
    expect(html).toContain("Target");
    expect(html).toContain("Allowance");
    expect(html).toContain("Consumed");
    expect(html).toContain("Remaining");
    expect(html).toContain("Budget");
    expect(html).toContain("99.95%");
    expect(html).toContain("21.6 min");
    expect(html).toContain("18.4 min");
    expect(html).toContain("3.2 min");
    expect(html).toContain("At risk");
    expect(html).toContain("Schedule A, section 4");
    expect(html.match(/Schedule A, section 4/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-penalty="incurred"');
    expect(html).toContain('data-penalty="projected"');
    expect(html).toContain("10% · 1,000 XXX");
    expect(html).toContain("25% · 2,500 XXX");
    expect(html).not.toContain("35%");
    expect(html).not.toContain("3,500");
    expect(html).toContain("18.4 of 21.6 min used; the next tier starts after 21.6 min");
    expect(html).toContain("At the current pace");
    expect(html).toContain(INGESTION_FAILED_LABEL);
    expect(html).toContain("Dropped rows");
    expect(html).not.toContain("prorated");
    expect(html).not.toContain("There is no status to show.");
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(html).toContain('name="backtest" value="scopely"');
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Backtest Scopely")(?=[^>]*\sdisabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Backtest Niantic")(?=[^>]*\sdisabled="")[^>]*>/);
    const niantic = html.slice(html.indexOf(">Niantic<"));
    expect(niantic).toContain("Compared with recent months");
    expect(niantic).not.toContain("Incurred");
  });

  it("shows a breach and a zero-credit tier together, and never prints 0% for an unentered clause", () => {
    const breaching = buildReadyDashboard({
      asOf,
      windowKey: "2026-06",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({
            status: "breaching",
            usedMinutes: 30,
            remainingMinutes: 0,
            nextTierStartsAfterMinutes: 216,
            reason: {
              rule: "breaching",
              fired: [],
              elapsedFraction: 1,
              consumedFraction: 30 / 21.6,
              projectedMinutes: 30,
              usedMinutes: 30,
              allowedMinutes: 21.6,
              burnRate: 1,
            },
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const breachHtml = renderToStaticMarkup(<TechnicalDashboard model={breaching} />);
    expect(breachHtml).toContain("Breaching");
    expect(breachHtml).toContain(">0%<");
    expect(breachHtml).toContain("Downtime has used 30 min of the 21.6 min allowance for this window.");
    expect(breachHtml).toContain("30 of 216 min used; the next tier starts after 216 min");

    const missing = buildReadyDashboard({
      asOf,
      windowKey: "2026-06",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({
            sourceClause: "  ",
            status: "meeting",
            penalty: {
              incurred: { kind: "unknown", statement: "penalty clause, not yet entered" },
              projected: { kind: "unknown", statement: "penalty clause, not yet entered" },
            },
            nextTierStartsAfterMinutes: null,
            reason: {
              rule: "meeting",
              fired: [],
              elapsedFraction: 0.5,
              consumedFraction: 0.2,
              projectedMinutes: 8,
              usedMinutes: 4,
              allowedMinutes: 21.6,
              burnRate: 0.4,
            },
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const missingHtml = renderToStaticMarkup(<TechnicalDashboard model={missing} />);
    expect(missingHtml).toContain("penalty clause, not yet entered");
    expect(missingHtml).toContain(CLAUSE_NOT_RECORDED);
    expect(missingHtml).not.toContain("0%");
    expect(missingHtml).not.toContain("the next tier starts after");

    const noClause = buildReadyDashboard({
      asOf,
      windowKey: "2026-06",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({
            penalty: {
              incurred: { kind: "none", statement: "no penalty clause" },
              projected: { kind: "none", statement: "no penalty clause" },
            },
            nextTierStartsAfterMinutes: null,
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const noneHtml = renderToStaticMarkup(<TechnicalDashboard model={noClause} />);
    expect(noneHtml).toContain("no penalty clause");
    expect(noneHtml).not.toContain("0%");
  });

  it("splits a partner into the contracted scopes and the outages those scopes do not cover", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2026-04",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({ partner: "niantic", outages: [] }),
          trackingRow({
            partner: "niantic",
            service: "igs-bb",
            usedMinutes: 6,
            incidentCount: 1,
            outages: [
              {
                pirKey: "POSTMORTEM-466",
                pirUrl: "https://jira.example/browse/POSTMORTEM-466",
                partnerId: 20450,
                severity: "l1",
                decisionType: null,
                reviewedBy: null,
                reviewedAt: null,
                source: "backfill",
                service: "igs-bb",
                incidentStarted: "2026-04-16T16:46:00.000Z",
                minutesInWindow: 6,
                totalMinutes: 6,
                mergeGroup: "1",
                countedMinutes: 6,
              },
            ],
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);
    const niantic = html.slice(html.indexOf(">Niantic<"), html.indexOf(">Kabam<"));
    expect(niantic.indexOf(">SLA<")).toBeGreaterThan(-1);
    expect(niantic.indexOf(">Tracking only<")).toBeGreaterThan(niantic.indexOf(">SLA<"));
    expect(niantic).toContain("Payments");
    expect(niantic).toContain("IGS-BB");
    expect(niantic).toContain("POSTMORTEM-466");
  });

  it("shows a prorated window start and the service an outage was filed against", () => {
    const model = buildReadyDashboard({
      asOf,
      windowKey: "2027-06",
      feed: {
        asOf: asOf.toISOString(),
        role: "technical",
        health: health(),
        rows: [
          scoredRow({
            allowedMinutes: 11.52,
            remainingMinutes: 6.52,
            windowStart: "2027-06-15T00:00:00.000Z",
            nextTierStartsAfterMinutes: 11.52,
            services: ["webshop", "shop-builder", "subscriptions"],
            outages: [
              {
                pirKey: "GTO-1",
                pirUrl: "https://jira.example/browse/GTO-1",
                partnerId: 151639,
                severity: "l1",
                decisionType: "ai_approved",
                reviewedBy: "ada",
                reviewedAt: null,
                source: null,
                service: "shop-builder",
                incidentStarted: "2027-06-20T00:00:00.000Z",
                minutesInWindow: 5,
                totalMinutes: 5,
                mergeGroup: "1",
                countedMinutes: 5,
              },
              {
                pirKey: "GTO-2",
                pirUrl: null,
                partnerId: 151639,
                severity: "l2",
                decisionType: "ai_approved",
                reviewedBy: "ada",
                reviewedAt: null,
                source: null,
                service: "subscriptions",
                incidentStarted: "2027-06-18T00:00:00.000Z",
                minutesInWindow: 5,
                totalMinutes: 5,
                mergeGroup: "2",
                countedMinutes: 5,
              },
            ],
          }),
        ],
        invalidTerms: [],
        ingestion: emptyIngestion(),
      },
    });
    const html = renderToStaticMarkup(<TechnicalDashboard model={model} />);
    expect(html).toContain("11.52 min");
    expect(html).toContain("Starts 2027-06-15. Allowance is prorated to this shorter window.");
    expect(html).toContain(FILED_AGAINST);
    expect(html).toContain("Shop Builder");
    expect(html).toContain("Subscriptions");
    expect(html).toContain("Webshop");
  });

  it("renders a bound partner's historical replay without turning no-exposure months into zeros", () => {
    const partners = buildPartnerGroups([scoredRow()]);
    const withReport = partners.map((partner) =>
      partner.id === "scopely"
        ? {
            ...partner,
            backtestPanel: toBacktestPanel({
              range: { description: "as far back as data exists", from: "2026-01-01", through: "2026-03-31" },
              partners: [
                {
                  months: [
                    { month: "2026-01", exposure: false, scopes: [] },
                    {
                      month: "2026-03",
                      exposure: true,
                      scopes: [
                        {
                          scopeId: "payments",
                          steps: 17,
                          rules: { breaching: 2, trend: 3, level: 4, meeting: 8 },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          }
        : partner,
    );
    const html = renderToStaticMarkup(<PartnerTable partners={withReport} windowKey="2026-06" />);
    expect(html).toContain("as far back as data exists: 2026-01-01 through 2026-03-31");
    expect(html).toContain("No exposure");
    expect(html).toContain("March 2026");
    expect(html).toContain(">2<");
    expect(html).toContain(">8<");
    const january = html.slice(html.indexOf("January 2026"), html.indexOf("March 2026"));
    expect(january).toContain("No exposure");
    expect(january).not.toMatch(/>0</);

    const failed = partners.map((partner) =>
      partner.id === "scopely" ? { ...partner, backtestPanel: { state: "error" as const, message: BACKTEST_FAILED } } : partner,
    );
    const errorHtml = renderToStaticMarkup(<PartnerTable partners={failed} windowKey="2026-06" />);
    expect(errorHtml).toContain(BACKTEST_FAILED);
    expect(errorHtml).not.toContain("No exposure");
  });

  it("keeps status sentences out of components", () => {
    const files = [
      "src/app/dashboard/scope-row.tsx",
      "src/app/dashboard/scored-row.tsx",
      "src/app/dashboard/partner-table.tsx",
      "src/app/dashboard/technical-dashboard.tsx",
      "src/app/dashboard/outage-lines.tsx",
      "src/app/dashboard/backtest-panel.tsx",
      "src/ui/budget-bar.tsx",
      "src/ui/status-badge.tsx",
    ];
    const source = files.map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
    expect(source).not.toContain("Downtime has used");
    expect(source).not.toContain("At the current pace");
    expect(source).not.toContain("Most of the allowance");
    expect(source).not.toContain("Most of the downtime");
    expect(source).not.toContain("within the allowance");
    expect(source).not.toContain("the next tier starts after");
    expect(source).not.toContain("no penalty clause");
    expect(source).not.toContain("not yet entered");
    expect(source).not.toContain("Clause reference not yet recorded");
    expect(source).not.toContain("prorated");
  });

  it("prints a text label on warning and danger badges", () => {
    expect(renderToStaticMarkup(<StatusBadge variant="warning" label="At risk" />)).toContain("At risk");
    expect(renderToStaticMarkup(<StatusBadge variant="danger" label="Breaching" />)).toContain("Breaching");
  });
});
