import type { PenaltyKind, PenaltyTier } from "@/engine";
import type { PartnerId, ServiceId } from "@/registry";

/**
 * Section 6.4. `tracking_only` is not stored on a file: it is what `listScopes`
 * means when it returns []. The other two states are written on a terms file.
 * Only `contract_bound` is visible to the engine.
 */
export const TERMS_LIFECYCLE_STATES = [
  "tracking_only",
  "terms_pending_review",
  "contract_bound",
] as const;

export type TermsLifecycle = (typeof TERMS_LIFECYCLE_STATES)[number];

export type { PenaltyKind, PenaltyTier };

/** Fee figure as written in the contract. Absent on `SlaTerms` means percentage-only reporting. */
export interface Money {
  /** Major units, as written. 10000 is 10,000 of `currency`, not cents. */
  amount: number;
  /** ISO 4217 code, as written. */
  currency: string;
}

/**
 * Engine terms. Fractions and below-threshold tiers. Produced by `loadContractFile`;
 * not the shape a contract file is written in.
 */
export interface SlaTerms {
  /** Uptime target as a fraction. 0.999 is 99.9%. */
  target: number;
  window: "calendar_month";
  /** Measurement timezone. Write it even when the value is UTC. */
  timezone: string;
  /** Instant the contract makes these terms effective. Never the date the file was added. */
  effectiveFrom: Date;
  /** Last instant these terms apply, inclusive. Null when the contract states no end. */
  effectiveTo: Date | null;
  penaltyKind: PenaltyKind;
  penaltyTiers: PenaltyTier[];
  /** Maximum credit fraction for this scope. Null when the contract states no per-scope cap. */
  perScopeCap: number | null;
  /** Maximum credit fraction across scopes. Null when the contract states no aggregate cap. */
  contractAggregateCap: number | null;
  /** Null when the contract states no minimum duration. */
  minimumCountableOutageMinutes: number | null;
  /** Clause reference for the figures in this record. Empty when the file omitted it. */
  sourceClause: string;
  /** Null means the contract states no fee and reporting stays in percentages. */
  monthlyFee: Money | null;
}

export type SlaScope =
  | {
      kind: "service";
      scopeId: string;
      /** Named services plus anything they include. One combined target. */
      services: readonly ServiceId[];
      terms: SlaTerms;
    }
  | {
      kind: "catch_all";
      scopeId: string;
      /**
       * Required. Read from the contract. No default.
       * true — an outage in a specifically scoped service also consumes this allowance.
       * false — this allowance covers only services no specific scope names.
       */
      includesScopedServices: boolean;
      terms: SlaTerms;
    };

/**
 * What the form saves and what a hand-authored file contains.
 * Percentages as the contract writes them. `loadContractFile` converts this
 * into `SlaScope` / `SlaTerms`.
 */
export interface ContractFile {
  partner: PartnerId;
  lifecycle: "terms_pending_review" | "contract_bound";
  /** Calendar date from the contract, `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Calendar date, inclusive, or null when the contract states no end. */
  effectiveTo: string | null;
  scopes: ContractScope[];
  /** Percent. Null when the contract states no aggregate cap. */
  contractAggregateCap: number | null;
}

export interface ContractScope {
  kind: "service" | "catch_all";
  scopeId: string;
  /** Kind `service` only. One or more registry ids, one combined target. */
  services?: ServiceId[];
  /** Kind `catch_all` only. Read from the contract. No default. */
  includesScopedServices?: boolean;
  /** Percent, for example 99.95. */
  target: number;
  penalty: ContractPenalty;
  /** Omitted figures still convert. The loader reports a warning. */
  sourceClause?: string;
}

export type ContractPenalty =
  | { kind: "none" }
  | { kind: "not_entered" }
  | {
      kind: "tiers";
      /** Percent. Highest `atOrAbove` first. The last `atOrAbove` is 0. */
      tiers: { atOrAbove: number; credit: number }[];
      /** Percent. Null when the contract states no per-scope cap. */
      perScopeCap: number | null;
    };

/** The contract-file body. Partner and lifecycle are stored beside it. */
export type ContractTermsBody = {
  effectiveFrom: string;
  effectiveTo: string | null;
  scopes: ContractScope[];
  contractAggregateCap: number | null;
};

type TermsFileBase = {
  partner: PartnerId;
  lifecycle: ContractFile["lifecycle"];
  effectiveFrom: string;
  effectiveTo: string | null;
  scopes: ContractScope[];
  contractAggregateCap: number | null;
};

/**
 * A hand-authored file. `example: true` is the format specimen only, and it
 * cannot be `contract_bound`. A real contract omits `example`.
 */
export type HandAuthoredTermsFile =
  | (TermsFileBase & {
      example: true;
      lifecycle: "terms_pending_review";
    })
  | (TermsFileBase & {
      example?: false;
      lifecycle: "terms_pending_review" | "contract_bound";
    });
