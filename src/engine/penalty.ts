import {
  NO_PENALTY_CLAUSE,
  PENALTY_NOT_ENTERED,
  type Money,
  type PenaltyFigure,
  type PenaltyTier,
  type SlaScope,
} from "./types";

/** 100% = 10_000. One basis point is 0.01%. */
const BASIS_POINTS = 10_000;
const MINUTE_MS = 60_000;

export type RawPenalty = number | "none" | "unknown";

function basisPoints(fraction: number): number {
  return Math.round(fraction * BASIS_POINTS);
}

/** Basis points of downtime at which a below-threshold tier starts. Above 100% always applies. */
function missedBasisPoints(belowAvailability: number): number {
  if (!Number.isFinite(belowAvailability)) {
    return Number.NEGATIVE_INFINITY;
  }
  return BASIS_POINTS - basisPoints(belowAvailability);
}

/**
 * Minutes of downtime allowed by an uptime target over a window.
 * `target` is a fraction. 0.9995 over 16 days is 11.52 minutes.
 */
export function allowanceMinutes(target: number, windowMinutes: number): number {
  const missed = BASIS_POINTS - basisPoints(target);
  return (windowMinutes * missed) / BASIS_POINTS;
}

/** True when downtime has passed this tier's threshold. An exact landing has not. */
function tierEntered(downtimeMs: number, windowMs: number, belowAvailability: number): boolean {
  const missedBp = missedBasisPoints(belowAvailability);
  return downtimeMs * BASIS_POINTS > windowMs * missedBp;
}

/**
 * Credit fraction for downtime against below-threshold tiers.
 * Compares integer milliseconds of downtime with integer basis points, so a
 * month that lands exactly on a threshold stays in the higher band.
 */
export function rawCredit(minutes: number, windowMinutes: number, tiers: readonly PenaltyTier[]): number {
  if (!(windowMinutes > 0) || !(minutes >= 0)) {
    return 0;
  }
  const downtimeMs = Math.round(minutes * MINUTE_MS);
  const windowMs = Math.round(windowMinutes * MINUTE_MS);
  let worst = 0;
  for (const tier of tiers) {
    if (tierEntered(downtimeMs, windowMs, tier.belowAvailability) && tier.creditFraction > worst) {
      worst = tier.creditFraction;
    }
  }
  return worst;
}

/**
 * Downtime minutes after which the next credit tier applies.
 * Uses the same strict comparison as `rawCredit`: landing exactly on a
 * threshold has not entered that tier. Null when no later tier remains.
 * `windowMinutes` is the scored window, already prorated when the scope
 * starts mid-month.
 */
export function nextTierStartsAfterMinutes(
  usedMinutes: number,
  windowMinutes: number,
  tiers: readonly PenaltyTier[],
): number | null {
  if (!(windowMinutes > 0) || !(usedMinutes >= 0)) {
    return null;
  }
  const downtimeMs = Math.round(usedMinutes * MINUTE_MS);
  const windowMs = Math.round(windowMinutes * MINUTE_MS);
  let nearest: number | null = null;
  for (const tier of tiers) {
    if (!Number.isFinite(tier.belowAvailability)) {
      continue;
    }
    if (tierEntered(downtimeMs, windowMs, tier.belowAvailability)) {
      continue;
    }
    const startsAfter = allowanceMinutes(tier.belowAvailability, windowMinutes);
    if (!Number.isFinite(startsAfter)) {
      continue;
    }
    if (nearest === null || startsAfter < nearest) {
      nearest = startsAfter;
    }
  }
  return nearest;
}

export function capAt(fraction: number, cap: number | null): number {
  if (cap === null) {
    return fraction;
  }
  return Math.min(fraction, cap);
}

/**
 * Per-scope caps are applied by the caller first. When the sum of those
 * credits still exceeds the contract cap, every scope is scaled by the same
 * factor so the sum equals the cap. Order of scopes does not change the result.
 */
export function scaleToAggregate(fractions: readonly number[], cap: number | null): number[] {
  if (cap === null) {
    return [...fractions];
  }
  const sum = fractions.reduce((total, fraction) => total + fraction, 0);
  if (!(sum > cap)) {
    return [...fractions];
  }
  const factor = cap / sum;
  return fractions.map((fraction) => fraction * factor);
}

/** Scales credit fractions. `none` and `unknown` stay as they are and do not enter the sum. */
export function scaleRawPenalties(values: readonly RawPenalty[], cap: number | null): RawPenalty[] {
  const indexes: number[] = [];
  const numeric: number[] = [];
  values.forEach((value, index) => {
    if (typeof value === "number") {
      indexes.push(index);
      numeric.push(value);
    }
  });
  const scaled = scaleToAggregate(numeric, cap);
  const result = [...values];
  indexes.forEach((index, position) => {
    result[index] = scaled[position] ?? 0;
  });
  return result;
}

export function sharedAggregateCap(scopes: readonly SlaScope[]): number | null {
  let cap: number | null = null;
  for (const scope of scopes) {
    const stated = scope.terms.contractAggregateCap;
    if (stated === null) {
      continue;
    }
    if (cap === null) {
      cap = stated;
      continue;
    }
    if (cap !== stated) {
      throw new Error(
        `contractAggregateCap differs across scopes (${cap} and ${stated}). The engine will not pick one.`,
      );
    }
  }
  return cap;
}

export function penaltyFigure(creditFraction: number, fee: Money | null): PenaltyFigure {
  return {
    kind: "credit",
    creditFraction,
    amount: fee === null ? null : { amount: creditFraction * fee.amount, currency: fee.currency },
  };
}

export function penaltyFor(credit: RawPenalty, fee: Money | null): PenaltyFigure {
  if (credit === "none") {
    return { kind: "none", statement: NO_PENALTY_CLAUSE };
  }
  if (credit === "unknown") {
    return { kind: "unknown", statement: PENALTY_NOT_ENTERED };
  }
  return penaltyFigure(credit, fee);
}
