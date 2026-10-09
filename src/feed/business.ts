import type { BaselineComparison, Evaluation, PartnerScopes, PenaltyFigure, StatusReason } from "@/engine";
import { contractedServiceIds, PARTNERS, SERVICES } from "@/registry";
import type { BusinessCredit, BusinessRow } from "./types";

export function toBusinessView(
  evaluations: readonly Evaluation[],
  scopes: readonly PartnerScopes[],
): BusinessRow[] {
  return evaluations.map((evaluation) => {
    if (evaluation.kind === "tracking_only") {
      return {
        kind: "tracking_only",
        partner: partnerName(evaluation.partner),
        partnerId: evaluation.partner,
        service: serviceName(evaluation.service),
        usedMinutes: evaluation.usedMinutes,
        incidentCount: evaluation.incidentCount,
        comparison: comparisonSentence(evaluation.comparison),
        history: evaluation.history,
        versusMedian: versusMedian(evaluation.comparison),
      };
    }

    return {
      kind: "scored",
      partner: partnerName(evaluation.partner),
      partnerId: evaluation.partner,
      scope: scopeLabel(scopes, evaluation.partner, evaluation.scopeId),
      status: evaluation.status,
      target: evaluation.target,
      consumedBudget: {
        usedMinutes: evaluation.usedMinutes,
        allowedMinutes: evaluation.allowedMinutes,
        fraction: evaluation.reason.consumedFraction,
      },
      windowMinutes: evaluation.windowMinutes,
      elapsedMinutes: evaluation.elapsedMinutes,
      history: evaluation.history,
      versusMedian: versusMedian(evaluation.comparison),
      projectedExhaustion: instant(evaluation.projectedExhaustion),
      creditPercentage: {
        incurred: creditReport(evaluation.penalty.incurred),
        projected: creditReport(evaluation.penalty.projected),
      },
      summary: renderStatusReason(evaluation.reason),
    };
  });
}

function renderStatusReason(reason: StatusReason): string {
  if (reason.rule === "breaching") {
    return "Downtime has used the full allowance for this window.";
  }
  if (reason.rule === "trend" && reason.fired.includes("level")) {
    return "Most of the allowance is already used, and the current pace would exhaust it before the window closes.";
  }
  if (reason.rule === "trend") {
    return "At the current pace, downtime will exhaust the allowance before the window closes.";
  }
  if (reason.rule === "level") {
    return "Most of the downtime allowance is already used.";
  }
  return "Downtime is within the allowance at this point in the window.";
}

function comparisonSentence(comparison: BaselineComparison): string {
  if (comparison.kind === "insufficient_history") {
    return "Not enough history to compare yet.";
  }
  if (comparison.kind === "no_prior_downtime") {
    return `First recorded downtime in the last ${comparison.coveredMonths} covered months.`;
  }
  const span = comparison.coveredMonths === 6 ? "six-month" : `${comparison.coveredMonths}-month`;
  if (comparison.versusMedian === "above") {
    return `Above this partner's ${span} median.`;
  }
  if (comparison.versusMedian === "below") {
    return `Below this partner's ${span} median.`;
  }
  return `Equal to this partner's ${span} median.`;
}

function versusMedian(comparison: BaselineComparison): "above" | "equal" | "below" | null {
  return comparison.kind === "compared" ? comparison.versusMedian : null;
}

function creditReport(figure: PenaltyFigure): BusinessCredit {
  if (figure.kind === "credit") {
    return { kind: "percent", percent: figure.creditFraction * 100 };
  }
  return figure;
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function partnerName(id: string): string {
  return PARTNERS.find((partner) => partner.id === id)?.displayName ?? id;
}

function serviceName(id: string): string {
  return SERVICES.find((service) => service.id === id)?.displayName ?? id;
}

function scopeLabel(scopes: readonly PartnerScopes[], partner: string, scopeId: string): string {
  const scope = scopes
    .find((entry) => entry.partner === partner)
    ?.scopes.find((candidate) => candidate.scopeId === scopeId);
  if (scope === undefined) {
    return scopeId;
  }
  if (scope.kind === "service") {
    return contractedServiceIds(scope.services).map((id) => serviceName(id)).join(", ");
  }
  if (scope.includesScopedServices) {
    return "All services";
  }
  return "General Scope";
}
