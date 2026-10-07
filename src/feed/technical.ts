import type { UsableOutage } from "@/data";
import type { Evaluation, OutageRef, PartnerScopes, SlaScope } from "@/engine";
import type { TechnicalOutage, TechnicalRow } from "./types";

export function toTechnicalView(
  evaluations: readonly Evaluation[],
  outages: readonly UsableOutage[],
  scopes: readonly PartnerScopes[] = [],
): TechnicalRow[] {
  const byPartnerAndKey = new Map<string, UsableOutage>();
  for (const outage of outages) {
    byPartnerAndKey.set(`${outage.partnerId}\0${outage.pirKey}`, outage);
  }

  return evaluations.map((evaluation) => {
    const rows = evaluation.outages.map((ref) =>
      technicalOutage(evaluation.partner, ref, byPartnerAndKey),
    );
    if (evaluation.kind === "tracking_only") {
      return {
        kind: "tracking_only",
        partner: evaluation.partner,
        service: evaluation.service,
        usedMinutes: evaluation.usedMinutes,
        incidentCount: evaluation.incidentCount,
        comparison: evaluation.comparison,
        history: evaluation.history,
        outages: rows,
      };
    }
    const scope = findScope(scopes, evaluation.partner, evaluation.scopeId);
    return {
      kind: "scored",
      partner: evaluation.partner,
      scopeId: evaluation.scopeId,
      target: evaluation.target,
      allowedMinutes: evaluation.allowedMinutes,
      usedMinutes: evaluation.usedMinutes,
      remainingMinutes: evaluation.remainingMinutes,
      burnRate: evaluation.burnRate,
      status: evaluation.status,
      projectedExhaustion:
        evaluation.projectedExhaustion === null
          ? null
          : evaluation.projectedExhaustion.toISOString(),
      windowStart: evaluation.windowStart.toISOString(),
      nextTierStartsAfterMinutes: evaluation.nextTierStartsAfterMinutes,
      windowMinutes: evaluation.windowMinutes,
      elapsedMinutes: evaluation.elapsedMinutes,
      history: evaluation.history,
      comparison: evaluation.comparison,
      sourceClause: sourceClauseOf(scope),
      services: scope?.kind === "service" ? scope.services : [],
      includesScopedServices: scope?.kind === "catch_all" ? scope.includesScopedServices : null,
      penalty: evaluation.penalty,
      reason: evaluation.reason,
      outages: rows,
    };
  });
}

function findScope(
  scopes: readonly PartnerScopes[],
  partner: string,
  scopeId: string,
): SlaScope | undefined {
  return scopes
    .find((entry) => entry.partner === partner)
    ?.scopes.find((scope) => scope.scopeId === scopeId);
}

function sourceClauseOf(scope: SlaScope | undefined): string {
  if (scope === undefined) {
    return "";
  }
  const clause = (scope.terms as { sourceClause?: unknown }).sourceClause;
  return typeof clause === "string" ? clause.trim() : "";
}

function technicalOutage(
  partner: string,
  ref: OutageRef,
  byPartnerAndKey: ReadonlyMap<string, UsableOutage>,
): TechnicalOutage {
  const source = byPartnerAndKey.get(`${partner}\0${ref.pirKey}`);
  if (source === undefined) {
    throw new Error(`Outage ${ref.pirKey} for ${partner} was evaluated without a source row.`);
  }
  return {
    pirKey: ref.pirKey,
    pirUrl: source.pirUrl,
    partnerId: source.merchantId,
    severity: source.severity,
    decisionType: source.decisionType,
    reviewedBy: source.reviewedBy,
    reviewedAt: source.reviewedAt === null ? null : source.reviewedAt.toISOString(),
    source: source.source,
    service: ref.service,
    incidentStarted: ref.incidentStarted.toISOString(),
    minutesInWindow: ref.minutes,
    totalMinutes: source.outageMinutes,
    mergeGroup: ref.mergeGroup,
    countedMinutes: ref.countedMinutes,
  };
}
