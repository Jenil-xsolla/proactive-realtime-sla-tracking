import type { BusinessRow, TechnicalRow } from "@/feed";

export const history = [
  { month: "2026-03", usedMinutes: null },
  { month: "2026-04", usedMinutes: 0 },
  { month: "2026-05", usedMinutes: 12 },
  { month: "2026-06", usedMinutes: 30 },
  { month: "2026-07", usedMinutes: 8 },
  { month: "2026-08", usedMinutes: 20 },
];

export function scoredRow(overrides: Partial<Extract<TechnicalRow, { kind: "scored" }>> = {}): TechnicalRow {
  return {
    kind: "scored",
    partner: "scopely",
    scopeId: "payments",
    target: 0.9995,
    allowedMinutes: 21.6,
    usedMinutes: 76,
    remainingMinutes: 0,
    burnRate: 3.5,
    status: "breached",
    projectedExhaustion: null,
    windowStart: "2026-09-01T00:00:00.000Z",
    nextTierStartsAfterMinutes: null,
    sourceClause: "",
    services: ["payments"],
    includesScopedServices: null,
    windowMinutes: 43200,
    elapsedMinutes: 21600,
    history,
    comparison: { kind: "compared", coveredMonths: 5, monthsWithDowntime: 4, medianMinutes: 12, currentMinutes: 76, versusMedian: "above" },
    penalty: {
      incurred: { kind: "credit", creditFraction: 0.05, amount: null },
      projected: { kind: "credit", creditFraction: 0.1, amount: null },
    },
    reason: { rule: "breaching", fired: [], elapsedFraction: 0.5, consumedFraction: 76 / 21.6, projectedMinutes: 152, usedMinutes: 76, allowedMinutes: 21.6, burnRate: 3.5 },
    outages: [
      {
        pirKey: "GTO-600", pirUrl: "https://jira.example/browse/GTO-600", partnerId: 151639, severity: "l1",
        decisionType: "system_written", reviewedBy: null, reviewedAt: null, source: "pipeline", service: "payments",
        incidentStarted: "2026-09-10T10:00:00.000Z", minutesInWindow: 50, totalMinutes: 50, mergeGroup: "1", countedMinutes: 50,
      },
      {
        pirKey: "GTO-601", pirUrl: null, partnerId: 151639, severity: "l2",
        decisionType: "system_written", reviewedBy: null, reviewedAt: null, source: "pipeline", service: "payments",
        incidentStarted: "2026-09-12T10:00:00.000Z", minutesInWindow: 26, totalMinutes: 26, mergeGroup: "2", countedMinutes: 26,
      },
    ],
    ...overrides,
  };
}

export function businessScoredRow(): BusinessRow {
  return {
    kind: "scored",
    partner: "Scopely",
    partnerId: "scopely",
    scope: "Payments",
    status: "at_risk",
    target: 0.9995,
    consumedBudget: { usedMinutes: 18.4, allowedMinutes: 21.6, fraction: 18.4 / 21.6 },
    windowMinutes: 43200,
    elapsedMinutes: 21600,
    history,
    versusMedian: "above",
    projectedExhaustion: "2026-09-28T00:00:00.000Z",
    creditPercentage: { incurred: { kind: "percent", percent: 0 }, projected: { kind: "percent", percent: 5 } },
    summary: "At the current pace, downtime will exhaust the allowance before the window closes.",
  };
}

export function trackingRow(overrides: Partial<Extract<TechnicalRow, { kind: "tracking_only" }>> = {}): TechnicalRow {
  return {
    kind: "tracking_only",
    partner: "scopely",
    service: "payments",
    usedMinutes: 42,
    incidentCount: 2,
    comparison: { kind: "compared", coveredMonths: 6, monthsWithDowntime: 4, currentMinutes: 42, medianMinutes: 10, versusMedian: "above" },
    history,
    outages: [
      {
        pirKey: "GTO-543", pirUrl: "https://jira.example/browse/GTO-543", partnerId: 151639, severity: "l1",
        decisionType: "ai_approved", reviewedBy: "ada", reviewedAt: "2026-09-02T23:55:00.000Z", source: null, service: "payments",
        incidentStarted: "2026-09-02T23:40:00.000Z", minutesInWindow: 20, totalMinutes: 20, mergeGroup: "1", countedMinutes: 20,
      },
    ],
    ...overrides,
  };
}

export function businessTrackingRow(): BusinessRow {
  return {
    kind: "tracking_only",
    partner: "Scopely",
    partnerId: "scopely",
    service: "Login",
    usedMinutes: 9,
    incidentCount: 1,
    comparison: "Not enough history to compare yet.",
    history,
    versusMedian: null,
  };
}
