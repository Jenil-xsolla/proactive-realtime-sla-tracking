import { emptyScope, type ContractFormScope, type ContractFormState } from "@/terms/review-contract";
import type { ContractFile, ContractScope } from "@/terms/types";

export function formStateFromTerms(terms: ContractFile, version: number): ContractFormState {
  return {
    effectiveFrom: terms.effectiveFrom,
    effectiveTo: terms.effectiveTo ?? "",
    contractAggregateCap: terms.contractAggregateCap,
    scopes: terms.scopes.map(scopeFromStored),
    updatedBy: "",
    expectedVersion: version,
  };
}

function scopeFromStored(scope: ContractScope): ContractFormScope {
  const tiers =
    scope.penalty.kind === "tiers"
      ? scope.penalty.tiers.map((tier, index, all) => ({
          atOrAbove: String(tier.atOrAbove),
          credit: String(tier.credit),
          fixed: index === all.length - 1 && tier.atOrAbove === 0,
        }))
      : emptyScope(scope.scopeId).tiers;
  return {
    scopeId: scope.scopeId,
    kind: scope.kind,
    services: scope.kind === "service" ? [...(scope.services ?? [])] : [],
    includesScopedServices:
      scope.kind === "catch_all"
        ? scope.includesScopedServices === true
          ? "yes"
          : scope.includesScopedServices === false
            ? "no"
            : ""
        : "",
    target: String(scope.target),
    penaltyKind: scope.penalty.kind,
    tiers,
    perScopeCap: scope.penalty.kind === "tiers" ? scope.penalty.perScopeCap : null,
    sourceClause: scope.sourceClause ?? "",
  };
}
