import type { PenaltyTier } from "@/engine";
import { SERVICES, type ServiceId } from "@/registry";
import type { ContractFile, ContractPenalty, ContractScope, SlaScope, SlaTerms } from "./types";

const SERVICE_IDS = new Set<string>(SERVICES.map((service) => service.id));

export type LoadedContract = {
  scopes: SlaScope[];
  warnings: string[];
};

/**
 * Validates a contract file and converts it into engine scopes.
 * Percentages become fractions. At-or-above bands become below-threshold tiers
 * by shifting each band's credit onto the threshold of the band above it.
 */
export function loadContractFile(file: ContractFile): LoadedContract {
  const effectiveFrom = parseDate(file.effectiveFrom, "effectiveFrom");
  const effectiveTo = file.effectiveTo === null ? null : endOfUtcDay(parseDate(file.effectiveTo, "effectiveTo"));
  const contractAggregateCap = percentOrNull(file.contractAggregateCap, "contractAggregateCap");
  const warnings: string[] = [];
  const scopes = file.scopes.map((scope) =>
    convertScope(scope, effectiveFrom, effectiveTo, contractAggregateCap, warnings),
  );
  return { scopes, warnings };
}

function convertScope(
  scope: ContractScope,
  effectiveFrom: Date,
  effectiveTo: Date | null,
  contractAggregateCap: number | null,
  warnings: string[],
): SlaScope {
  if (!(scope.target >= 0 && scope.target <= 100)) {
    throw new Error(`Scope "${scope.scopeId}" target must be from 0 to 100. Received ${scope.target}.`);
  }
  const sourceClause = scope.sourceClause?.trim() ?? "";
  if (sourceClause === "") {
    warnings.push(`Scope "${scope.scopeId}" has no sourceClause.`);
  }
  const penalty = convertPenalty(scope.scopeId, scope.penalty);
  const terms: SlaTerms = {
    target: scope.target / 100,
    window: "calendar_month",
    timezone: "UTC",
    effectiveFrom,
    effectiveTo,
    penaltyKind: penalty.penaltyKind,
    penaltyTiers: penalty.penaltyTiers,
    perScopeCap: penalty.perScopeCap,
    contractAggregateCap,
    minimumCountableOutageMinutes: null,
    sourceClause,
    monthlyFee: null,
  };

  if (scope.kind === "catch_all") {
    if (typeof scope.includesScopedServices !== "boolean") {
      throw new Error(
        `Scope "${scope.scopeId}" is a catch-all and must state includesScopedServices. Copy it from the contract. true means an outage in a specifically scoped service also consumes this allowance. false means the catch-all covers only services no specific scope names. There is no default.`,
      );
    }
    return {
      kind: "catch_all",
      scopeId: scope.scopeId,
      includesScopedServices: scope.includesScopedServices,
      terms,
    };
  }

  if (scope.kind !== "service") {
    throw new Error(`Scope "${scope.scopeId}" kind must be service or catch_all.`);
  }
  if (scope.services === undefined || scope.services.length === 0) {
    throw new Error(`Scope "${scope.scopeId}" is a service scope and needs at least one service.`);
  }
  return {
    kind: "service",
    scopeId: scope.scopeId,
    services: expandServices(scope.scopeId, scope.services),
    terms,
  };
}

function convertPenalty(
  scopeId: string,
  penalty: ContractPenalty,
): Pick<SlaTerms, "penaltyKind" | "penaltyTiers" | "perScopeCap"> {
  if (penalty.kind === "none" || penalty.kind === "not_entered") {
    return { penaltyKind: penalty.kind, penaltyTiers: [], perScopeCap: null };
  }
  if (penalty.kind !== "tiers") {
    throw new Error(`Scope "${scopeId}" penalty kind must be none, not_entered, or tiers.`);
  }
  return {
    penaltyKind: "tiers",
    penaltyTiers: shiftTiers(scopeId, penalty.tiers),
    perScopeCap: percentOrNull(penalty.perScopeCap, `Scope "${scopeId}" perScopeCap`),
  };
}

/**
 * at or above 99.95 -> 0, at or above 99.50 -> 5
 * becomes belowAvailability 0.9995 -> creditFraction 0.05.
 * A non-zero credit on the top band has no higher threshold, so it applies
 * at every availability, including 100%.
 */
function shiftTiers(scopeId: string, tiers: { atOrAbove: number; credit: number }[]): PenaltyTier[] {
  const last = tiers[tiers.length - 1];
  if (last === undefined || last.atOrAbove !== 0) {
    throw new Error(`Scope "${scopeId}" last tier atOrAbove must be 0 so every month matches a tier.`);
  }
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    const current = tiers[index];
    if (previous === undefined || current === undefined || !(current.atOrAbove < previous.atOrAbove)) {
      throw new Error(
        `Scope "${scopeId}" tiers must be strictly decreasing by atOrAbove. ${String(previous?.atOrAbove)} then ${String(current?.atOrAbove)} is not strictly decreasing.`,
      );
    }
  }

  const converted: PenaltyTier[] = [];
  const top = tiers[0];
  if (top !== undefined && top.credit !== 0) {
    converted.push({
      belowAvailability: Number.POSITIVE_INFINITY,
      creditFraction: top.credit / 100,
    });
  }
  for (let index = 1; index < tiers.length; index += 1) {
    const above = tiers[index - 1];
    const band = tiers[index];
    if (above === undefined || band === undefined) {
      continue;
    }
    converted.push({
      belowAvailability: above.atOrAbove / 100,
      creditFraction: band.credit / 100,
    });
  }
  return converted;
}

function expandServices(scopeId: string, named: readonly ServiceId[]): ServiceId[] {
  const expanded: ServiceId[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!SERVICE_IDS.has(id)) {
      throw new Error(`Scope "${scopeId}" names "${id}", which is not a registry service id.`);
    }
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    expanded.push(id as ServiceId);
  };
  for (const id of named) {
    add(id);
    const entry = SERVICES.find((service) => service.id === id);
    const included = entry !== undefined && "includes" in entry ? entry.includes : undefined;
    for (const child of included ?? []) {
      add(child);
    }
  }
  return expanded;
}

function percentOrNull(value: number | null, label: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a percent or null.`);
  }
  return value / 100;
}

function parseDate(value: string, field: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`${field} "${value}" is not a calendar date (YYYY-MM-DD).`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error(`${field} "${value}" is not a calendar date (YYYY-MM-DD).`);
  }
  return utc;
}

function endOfUtcDay(start: Date): Date {
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}
