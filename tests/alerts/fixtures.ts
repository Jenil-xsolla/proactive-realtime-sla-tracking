import { UNUSABLE_REASONS, type OutageHealth } from "@/data";
import type { SlaFeed, TechnicalRow } from "@/feed";

const PIR_KEY = "GTO-543";
const MERCHANT_ID = 151639;
const REVIEWER = "ada.lovelace";

export function systemFeed(rows: TechnicalRow[], asOf = "2026-09-15T12:00:00.000Z"): SlaFeed {
  return {
    asOf,
    role: "system",
    health: emptyHealth(),
    rows,
    invalidTerms: [],
    ingestion: { status: "ok", counts: { failed: 0, unresolved: 0, withoutMessage: 0 }, failed: [], unresolved: [], withoutMessage: [] },
  };
}

export function scoredRow(
  status: "meeting" | "at_risk" | "breaching",
): Extract<TechnicalRow, { kind: "scored" }> {
  return {
    kind: "scored",
    partner: "scopely",
    scopeId: "payments-monthly",
    target: 0.999,
    allowedMinutes: 43.2,
    usedMinutes: status === "meeting" ? 1 : 40,
    remainingMinutes: 3.2,
    burnRate: 2,
    status,
    projectedExhaustion: null,
    windowStart: "2026-09-01T00:00:00.000Z",
    nextTierStartsAfterMinutes: null,
    sourceClause: "Schedule A",
    services: ["payments"],
    includesScopedServices: null,
    penalty: {
      incurred: { kind: "credit", creditFraction: 0.1, amount: null },
      projected: { kind: "credit", creditFraction: 0.25, amount: null },
    },
    reason: {
      rule: status === "breaching" ? "breaching" : status === "at_risk" ? "trend" : "meeting",
      fired: status === "at_risk" ? ["trend"] : [],
      elapsedFraction: 0.5,
      consumedFraction: 0.9,
      projectedMinutes: 80,
      usedMinutes: status === "meeting" ? 1 : 40,
      allowedMinutes: 43.2,
      burnRate: 2,
    },
    outages: [
      {
        pirKey: PIR_KEY,
        pirUrl: `https://jira.example/browse/${PIR_KEY}`,
        partnerId: MERCHANT_ID,
        severity: "l1",
        decisionType: "ai_approved",
        reviewedBy: REVIEWER,
        reviewedAt: "2026-04-16T13:00:00.000Z",
        source: null,
        service: "payments",
        incidentStarted: "2026-04-16T12:00:00.000Z",
        minutesInWindow: 40,
        totalMinutes: 40,
        mergeGroup: "1",
        countedMinutes: 40,
      },
    ],
  };
}

export function trackingRow(input: {
  comparison: Extract<TechnicalRow, { kind: "tracking_only" }>["comparison"];
  usedMinutes: number;
}): Extract<TechnicalRow, { kind: "tracking_only" }> {
  return {
    kind: "tracking_only",
    partner: "second-dinner",
    service: "payments",
    usedMinutes: input.usedMinutes,
    incidentCount: 1,
    comparison: input.comparison,
    outages: [
      {
        pirKey: "GTO-100",
        pirUrl: "https://jira.example/browse/GTO-100",
        partnerId: 506855,
        severity: "l1",
        decisionType: "ai_approved",
        reviewedBy: "quinn.chen",
        reviewedAt: "2026-09-02T00:00:00.000Z",
        source: null,
        service: "payments",
        incidentStarted: "2026-09-02T00:00:00.000Z",
        minutesInWindow: input.usedMinutes,
        totalMinutes: input.usedMinutes,
        mergeGroup: "1",
        countedMinutes: input.usedMinutes,
      },
    ],
  };
}

export const SCORED_PIR = PIR_KEY;
export const SCORED_MERCHANT = String(MERCHANT_ID);
export const SCORED_REVIEWER = REVIEWER;
export const AS_OF = new Date("2026-09-15T12:00:00.000Z");
export const SCORED_KEY = {
  partnerSlug: "scopely",
  scopeId: "payments-monthly",
  period: "2026-09",
};

function emptyHealth(): OutageHealth {
  return {
    usableCount: 0,
    unusableCount: 0,
    countsByReason: Object.fromEntries(UNUSABLE_REASONS.map((reason) => [reason, 0])) as OutageHealth["countsByReason"],
    unresolvedPartnerNames: [],
    unresolvedServiceNames: [],
    partnersWithZeroAttributedRows: [],
  };
}
