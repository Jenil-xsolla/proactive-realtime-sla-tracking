import type { IngestionHealth, OutageHealth, OutagePartition, OutageProvenance, UnresolvedValue, UnusableReason } from "@/data";
import type { BaselineComparison, PenaltyFigure, StatusReason } from "@/engine";
import type { SeverityId } from "@/registry";
import type { SlaTermsProvider } from "@/terms";
import type { ViewerRole } from "./viewer";

/**
 * Optional stand-ins for tests. Production routes omit this and read the
 * database plus the empty terms provider.
 */
export type FeedSources = {
  partition?: OutagePartition;
  terms?: SlaTermsProvider;
  ingestion?: IngestionHealth;
};

export type IngestionCounts = {
  failed: number;
  unresolved: number;
  withoutMessage: number;
};

/**
 * Full ingestion health for the technical and system roles: failed PIRs,
 * captured PIRs with unresolved values, and captured PIRs without a Slack
 * message, each with keys and URLs (design §2, §4). `status: "error"` when
 * loading it threw — the feed does not fail, but this is never rendered as
 * a zero (main spec §9.3).
 */
export type IngestionHealthDetail =
  | { status: "error" }
  | {
      status: "ok";
      counts: IngestionCounts;
      failed: { pirKey: string; pirUrl: string | null; error: string | null; updatedAt: string }[];
      unresolved: { pirKey: string; pirUrl: string | null; values: UnresolvedValue[] }[];
      withoutMessage: { pirKey: string; pirUrl: string | null; slackError: string }[];
    };

/**
 * Business-role ingestion health: counts only, no PIR key, URL, error text
 * or raw unresolved values (main spec §8.2).
 */
export type IngestionHealthCounts = { status: "error" } | { status: "ok"; counts: IngestionCounts };

/** Defined in @/data as sla_outages.source's parsed type; re-exported here for feed consumers. */
export type { OutageProvenance };

export type TechnicalOutage = {
  pirKey: string;
  pirUrl: string | null;
  /** External merchant id from sla_outages.partner_id. */
  partnerId: number | null;
  severity: SeverityId;
  decisionType: string | null;
  reviewedBy: string | null;
  /** ISO-8601. Null when the usable row has no reviewed_at. */
  reviewedAt: string | null;
  source: OutageProvenance | null;
  service: string;
  incidentStarted: string;
  /** Minutes of this outage inside the window, before overlap merging. */
  minutesInWindow: number;
  /** Full outage_minutes from the usable row, including time outside the window. */
  totalMinutes: number;
  /** Shared by outages the engine merged into one interval. */
  mergeGroup: string;
  /**
   * Minutes this outage adds after earlier members of its merge group.
   * Summing this across the row equals usedMinutes.
   */
  countedMinutes: number;
};

export type TechnicalRow =
  | {
      kind: "tracking_only";
      partner: string;
      service: string;
      usedMinutes: number;
      incidentCount: number;
      comparison: BaselineComparison;
      outages: TechnicalOutage[];
    }
  | {
      kind: "scored";
      partner: string;
      scopeId: string;
      target: number;
      allowedMinutes: number;
      usedMinutes: number;
      remainingMinutes: number;
      burnRate: number;
      status: "meeting" | "at_risk" | "breaching";
      projectedExhaustion: string | null;
      penalty: { incurred: PenaltyFigure; projected: PenaltyFigure };
      reason: StatusReason;
      outages: TechnicalOutage[];
    };

export type BusinessRow =
  | {
      kind: "tracking_only";
      partner: string;
      service: string;
      usedMinutes: number;
      incidentCount: number;
      comparison: string;
    }
  | {
      kind: "scored";
      partner: string;
      scope: string;
      status: "meeting" | "at_risk" | "breaching";
      consumedBudget: {
        usedMinutes: number;
        allowedMinutes: number;
        /** Null when the allowance is zero and the ratio is undefined. */
        fraction: number | null;
      };
      projectedExhaustion: string | null;
      /** 10 is a 10% credit. Incurred and projected stay separate. */
      creditPercentage: {
        incurred: number;
        projected: number;
      };
      summary: string;
    };

export type SlaFeed = {
  asOf: string;
  health: OutageHealth;
} & (
  | { role: "business"; rows: BusinessRow[]; ingestion: IngestionHealthCounts }
  | { role: "technical" | "system"; rows: TechnicalRow[]; ingestion: IngestionHealthDetail }
);

export type UnusableRow = {
  pirKey: string;
  partner: string;
  /** External merchant id, when the text parsed. */
  partnerId: number | null;
  affectedService: string | null;
  incidentStarted: string | null;
  rawOutageMinutes: string | null;
  reasons: UnusableReason[];
};

export type SlaHealth =
  | { asOf: string; role: "business"; health: OutageHealth; ingestion: IngestionHealthCounts }
  | {
      asOf: string;
      role: Exclude<ViewerRole, "business">;
      health: OutageHealth;
      unusable: UnusableRow[];
      ingestion: IngestionHealthDetail;
    };
