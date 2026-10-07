export type Money = {
  /** Major units, as written. */
  amount: number;
  /** ISO 4217 code, as written. */
  currency: string;
};

export type PenaltyTier = {
  /** Tier applies when achieved availability is strictly below this fraction. */
  belowAvailability: number;
  /** Credit as a fraction of fees. 0.1 is a 10% credit. */
  creditFraction: number;
};

/**
 * Fields the engine reads. Section 7.3 counts only incident start and outage
 * minutes. Excluded events never become outage rows.
 */
export type PenaltyKind = "none" | "not_entered" | "tiers";

export type EngineTerms = {
  /** Uptime target as a fraction. 0.999 is 99.9%. */
  target: number;
  window: "calendar_month";
  /** Must be WINDOW_TIMEZONE. The engine does not convert other zones. */
  timezone: string;
  effectiveFrom: Date;
  /** Last instant these terms apply, inclusive. Null when the contract states no end. */
  effectiveTo: Date | null;
  /**
   * `none` — the contract has no penalty for this scope.
   * `not_entered` — a penalty exists and its figures are not in the file yet.
   * `tiers` — `penaltyTiers` is the below-threshold table.
   */
  penaltyKind: PenaltyKind;
  penaltyTiers: readonly PenaltyTier[];
  /** Maximum credit fraction for this scope. Null when the contract states no per-scope cap. */
  perScopeCap: number | null;
  /** Maximum credit fraction across scopes. Null when the contract states no aggregate cap. */
  contractAggregateCap: number | null;
  /** Null means percentage-only reporting. */
  monthlyFee: Money | null;
};

export type SlaScope<S extends string = string> =
  | {
      kind: "service";
      scopeId: string;
      /** Registry service ids this scope covers, already expanded by the terms loader. */
      services: readonly S[];
      terms: EngineTerms;
    }
  | {
      kind: "catch_all";
      scopeId: string;
      includesScopedServices: boolean;
      terms: EngineTerms;
    };

export type PartnerScopes<P extends string = string, S extends string = string> = {
  partner: P;
  scopes: readonly SlaScope<S>[];
};

/** Subset of a usable outage. Callers may pass rows that carry extra fields. */
export type UsableOutage<P extends string = string, S extends string = string> = {
  pirKey: string;
  partnerId: P;
  serviceId: S;
  incidentStarted: Date;
  /** Wall-clock minutes. Always greater than zero on a real outage. */
  outageMinutes: number;
};

/** Inclusive start, exclusive end. Instants are UTC. */
export type Window = {
  start: Date;
  end: Date;
};

export type OutageRef<S extends string = string> = {
  pirKey: string;
  service: S;
  incidentStarted: Date;
  /** Minutes of this outage inside the result, before overlap merging. */
  minutes: number;
  /** Shared by outages whose in-window intervals were merged together. */
  mergeGroup: string;
  /**
   * Minutes this outage adds to the scope total after earlier members of its
   * merge group. The sum across a scope equals usedMinutes.
   */
  countedMinutes: number;
};

/**
 * Comparison against the covered prior months only. A month that starts
 * before data coverage is omitted, never counted as zero downtime.
 */
/**
 * Used minutes for one prior calendar month. `null` when the month starts
 * before data coverage: unknown, never a clean zero.
 */
export type MonthHistory = { month: string; usedMinutes: number | null };

export type BaselineComparison =
  | {
      kind: "insufficient_history";
      /** Prior months whose start falls on or after data coverage. */
      coveredMonths: number;
      /** Covered prior months with any recorded downtime. */
      monthsWithDowntime: number;
    }
  | {
      kind: "no_prior_downtime";
      coveredMonths: number;
      monthsWithDowntime: 0;
    }
  | {
      kind: "compared";
      coveredMonths: number;
      monthsWithDowntime: number;
      /** Median used minutes across covered prior months, including covered zeros. */
      medianMinutes: number;
      currentMinutes: number;
      versusMedian: "above" | "equal" | "below";
    };

export type StatusRule = "breaching" | "trend" | "level" | "meeting";

/**
 * Which rule determined status, plus the inputs that produced it.
 * `fired` lists every at-risk clause that matched. It is empty for breaching
 * and meeting. When trend and level both match, both are listed and `rule`
 * is `trend` (the clause written first in section 7.4).
 */
export type StatusReason = {
  rule: StatusRule;
  fired: readonly ("trend" | "level")[];
  elapsedFraction: number;
  /** Null when allowance is zero and the ratio is undefined. */
  consumedFraction: number | null;
  projectedMinutes: number;
  usedMinutes: number;
  allowedMinutes: number;
  /**
   * consumedFraction / elapsedFraction.
   * 1 means the current pace exhausts the allowance exactly at window close.
   * 0 when elapsed time is zero or allowance is zero.
   */
  burnRate: number;
};

export const NO_PENALTY_CLAUSE = "no penalty clause" as const;
export const PENALTY_NOT_ENTERED = "penalty clause, not yet entered" as const;

export type PenaltyFigure =
  | { kind: "none"; statement: typeof NO_PENALTY_CLAUSE }
  | { kind: "unknown"; statement: typeof PENALTY_NOT_ENTERED }
  | {
      kind: "credit";
      /** Credit fraction after per-scope and contract-aggregate caps. */
      creditFraction: number;
      /** Null when the scope has no monthlyFee. */
      amount: Money | null;
    };

export type Evaluation<P extends string = string, S extends string = string> =
  | {
      kind: "tracking_only";
      partner: P;
      service: S;
      usedMinutes: number;
      incidentCount: number;
      comparison: BaselineComparison;
      /** Six calendar months before the window's month, oldest first. */
      history: MonthHistory[];
      outages: OutageRef<S>[];
    }
  | {
      kind: "scored";
      partner: P;
      scopeId: string;
      target: number;
      allowedMinutes: number;
      usedMinutes: number;
      remainingMinutes: number;
      burnRate: number;
      status: "meeting" | "at_risk" | "breaching";
      projectedExhaustion: Date | null;
      /** First instant this scope is scored in the requested window. */
      windowStart: Date;
      /**
       * Downtime minutes after which the next credit tier applies.
       * Null when the penalty is not tiered, or the scope is already in the last tier.
       */
      nextTierStartsAfterMinutes: number | null;
      /** Full scored window length in minutes. Shorter than the calendar month when prorated. */
      windowMinutes: number;
      /** Minutes of the scored window elapsed at asOf, clamped to [0, windowMinutes]. */
      elapsedMinutes: number;
      /** Six calendar months before the window's month, oldest first, over this scope's services. */
      history: MonthHistory[];
      /** Same baseline the tracking row uses, over this scope's outages. Descriptive only. */
      comparison: BaselineComparison;
      penalty: { incurred: PenaltyFigure; projected: PenaltyFigure };
      reason: StatusReason;
      outages: OutageRef<S>[];
    };
