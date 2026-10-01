import type { PartnerId } from "@/registry";
import type { SlaScope } from "./types";

/** Engine-shaped file after `loadContractFile`. Fixtures use this directly. */
export type SelectableTermsFile = {
  partner: PartnerId;
  example?: boolean;
  lifecycle: string;
  scopes: readonly SlaScope[];
};

/**
 * Scopes whose file is `contract_bound` and whose effective window contains `asOf`.
 * `effectiveFrom` and `effectiveTo` are inclusive. A null `effectiveTo` does not end.
 * `terms_pending_review` contributes nothing.
 */
export function scopesForPartner(
  files: readonly SelectableTermsFile[],
  partner: PartnerId,
  asOf: Date,
): SlaScope[] {
  const scopes: SlaScope[] = [];

  for (const file of files) {
    if (file.partner !== partner) {
      continue;
    }

    const markedExample = file.example === true;
    const lifecycle: string = file.lifecycle;

    if (markedExample && lifecycle === "contract_bound") {
      throw new Error(
        `Terms file for ${partner} is marked example and contract_bound. The worked example is not a contract. Remove example only when the file is a reviewed contract.`,
      );
    }

    if (lifecycle !== "terms_pending_review" && lifecycle !== "contract_bound") {
      throw new Error(
        `Terms file for ${partner} has lifecycle "${lifecycle}". A file is terms_pending_review or contract_bound. tracking_only is an empty listScopes result.`,
      );
    }

    if (lifecycle !== "contract_bound") {
      continue;
    }

    for (const scope of file.scopes) {
      assertIncludesScopedServices(partner, scope);
      if (scopeInForce(scope, asOf)) {
        scopes.push(scope);
      }
    }
  }

  return scopes;
}

function assertIncludesScopedServices(partner: PartnerId, scope: SlaScope): void {
  if (scope.kind !== "catch_all") {
    return;
  }

  const stated = "includesScopedServices" in scope ? scope.includesScopedServices : undefined;
  if (typeof stated !== "boolean") {
    throw new Error(
      `Catch-all scope "${scope.scopeId}" for ${partner} does not state includesScopedServices. Copy it from the contract. true means an outage in a specifically scoped service also consumes the catch-all allowance. false means the catch-all covers only services no specific scope names. There is no default.`,
    );
  }
}

function scopeInForce(scope: SlaScope, asOf: Date): boolean {
  const at = asOf.getTime();
  if (at < scope.terms.effectiveFrom.getTime()) {
    return false;
  }
  if (scope.terms.effectiveTo !== null && at > scope.terms.effectiveTo.getTime()) {
    return false;
  }
  return true;
}
