import {
  PARTNERS,
  resolvePartner,
  resolveService,
  resolveSeverity,
  type PartnerId,
  type ServiceId,
  type SeverityId,
} from "@/registry";
import type { Database } from "./db";
import { parseMerchantId } from "./merchant-id";
import { slaOutages } from "./schema/outages";

export const UNUSABLE_REASONS = [
  "missing_outage_minutes",
  "invalid_outage_minutes",
  "missing_incident_started",
  "invalid_partner_id",
  "unresolved_partner",
  "missing_affected_service",
  "unresolved_service",
  "missing_severity",
  "unresolved_severity",
] as const;

export type UnusableReason = (typeof UNUSABLE_REASONS)[number];

const OUTAGE_PROVENANCES = ["pipeline", "backfill"] as const;

/** sla_outages.source: 'pipeline' (written by ingestion) or 'backfill' (imported history). */
export type OutageProvenance = (typeof OUTAGE_PROVENANCES)[number];

function parseSource(value: string): OutageProvenance | null {
  return (OUTAGE_PROVENANCES as readonly string[]).includes(value) ? (value as OutageProvenance) : null;
}

/**
 * A row as node-postgres / Drizzle returns it.
 * outageMinutes and partnerId are still strings.
 */
export type OutageSourceRow = {
  id: number;
  pirKey: string;
  partner: string;
  /** Raw sla_outages.partner_id. External merchant id text, not a foreign key. */
  partnerId: string | null;
  incidentStarted: Date | null;
  affectedService: string | null;
  outageMinutes: string | null;
  severity: string | null;
  /** Raw sla_outages.source. */
  source: string;
  reviewedBy: string | null;
  decisionType: string | null;
  reviewedAt: Date | null;
  pirUrl: string | null;
};

export type UsableOutage = {
  id: number;
  pirKey: string;
  pirUrl: string | null;
  /** Registry slug. This is what evaluation groups on. */
  partnerId: PartnerId;
  /** Parsed sla_outages.partner_id. Null when the row had no merchant id. */
  merchantId: number | null;
  serviceId: ServiceId;
  incidentStarted: Date;
  outageMinutes: number;
  severity: SeverityId;
  /** Parsed sla_outages.source. Null when the value is neither pipeline nor backfill. */
  source: OutageProvenance | null;
  reviewedBy: string | null;
  decisionType: string | null;
  reviewedAt: Date | null;
};

export type UnusableOutage = {
  id: number;
  pirKey: string;
  partner: string;
  merchantId: number | null;
  /** Set when the partner resolved but the row failed for another reason. */
  resolvedPartnerId: PartnerId | null;
  affectedService: string | null;
  incidentStarted: Date | null;
  rawOutageMinutes: string | null;
  reasons: UnusableReason[];
};

export type OutagePartition = {
  usable: UsableOutage[];
  unusable: UnusableOutage[];
};

export type OutageHealth = {
  usableCount: number;
  unusableCount: number;
  countsByReason: Record<UnusableReason, number>;
  unresolvedPartnerNames: string[];
  unresolvedServiceNames: string[];
  /** Registry slugs with no resolved row in this partition. Derived from rows, not from audit prose. */
  partnersWithZeroAttributedRows: PartnerId[];
};

function parseOutageMinutes(
  value: string | null,
): { ok: true; minutes: number } | { ok: false; reason: "missing_outage_minutes" | "invalid_outage_minutes" } {
  if (value === null || value.trim() === "") {
    return { ok: false, reason: "missing_outage_minutes" };
  }
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    return { ok: false, reason: "invalid_outage_minutes" };
  }
  return { ok: true, minutes };
}

function startedAt(value: Date | null): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}

export function partitionOutages(rows: readonly OutageSourceRow[]): OutagePartition {
  const usable: UsableOutage[] = [];
  const unusable: UnusableOutage[] = [];

  for (const row of rows) {
    const reasons: UnusableReason[] = [];
    const minutes = parseOutageMinutes(row.outageMinutes);
    if (!minutes.ok) {
      reasons.push(minutes.reason);
    }

    const incidentStarted = startedAt(row.incidentStarted);
    if (incidentStarted === null) {
      reasons.push("missing_incident_started");
    }

    const parsedMerchantId = parseMerchantId(row.partnerId);
    let merchantId: number | null = null;
    let partner: ReturnType<typeof resolvePartner>;
    if (parsedMerchantId.status === "invalid") {
      reasons.push("invalid_partner_id");
      partner = { status: "unresolved", raw: parsedMerchantId.raw };
    } else if (parsedMerchantId.status === "absent") {
      partner = resolvePartner({ merchantId: null, name: row.partner });
      if (partner.status === "unresolved") {
        reasons.push("unresolved_partner");
      }
    } else {
      merchantId = parsedMerchantId.merchantId;
      partner = resolvePartner({ merchantId, name: row.partner });
      if (partner.status === "unresolved") {
        reasons.push("unresolved_partner");
      }
    }

    const serviceName = row.affectedService?.trim() ?? "";
    const service = serviceName.length === 0 ? null : resolveService(row.affectedService ?? "");
    if (service === null) {
      reasons.push("missing_affected_service");
    } else if (service.status === "unresolved") {
      reasons.push("unresolved_service");
    }

    const severityLabel = row.severity?.trim() ?? "";
    const severity = severityLabel.length === 0 ? null : resolveSeverity(row.severity ?? "");
    if (severity === null) {
      reasons.push("missing_severity");
    } else if (severity.status === "unresolved") {
      reasons.push("unresolved_severity");
    }

    if (
      reasons.length > 0 ||
      !minutes.ok ||
      incidentStarted === null ||
      service === null ||
      service.status !== "resolved" ||
      partner.status !== "resolved" ||
      severity === null ||
      severity.status !== "resolved"
    ) {
      unusable.push({
        id: row.id,
        pirKey: row.pirKey,
        partner: row.partner,
        merchantId,
        resolvedPartnerId: partner.status === "resolved" ? partner.id : null,
        affectedService: row.affectedService,
        incidentStarted: row.incidentStarted,
        rawOutageMinutes: row.outageMinutes,
        reasons,
      });
      continue;
    }

    usable.push({
      id: row.id,
      pirKey: row.pirKey,
      pirUrl: row.pirUrl,
      partnerId: partner.id,
      merchantId,
      serviceId: service.id,
      incidentStarted,
      outageMinutes: minutes.minutes,
      severity: severity.id,
      source: parseSource(row.source),
      reviewedBy: row.reviewedBy,
      decisionType: row.decisionType,
      reviewedAt: row.reviewedAt,
    });
  }

  return { usable, unusable };
}

export function summarizeOutageHealth(partition: OutagePartition): OutageHealth {
  const countsByReason = Object.fromEntries(UNUSABLE_REASONS.map((reason) => [reason, 0])) as Record<
    UnusableReason,
    number
  >;
  const unresolvedPartnerNames = new Set<string>();
  const unresolvedServiceNames = new Set<string>();
  const attributed = new Set<PartnerId>();

  for (const row of partition.usable) {
    attributed.add(row.partnerId);
  }

  for (const row of partition.unusable) {
    for (const reason of row.reasons) {
      countsByReason[reason] += 1;
    }
    if (row.resolvedPartnerId !== null) {
      attributed.add(row.resolvedPartnerId);
    }
    if (row.reasons.includes("unresolved_partner") && row.partner.trim() !== "") {
      unresolvedPartnerNames.add(row.partner.trim());
    }
    if (
      row.reasons.includes("unresolved_service") &&
      row.affectedService !== null &&
      row.affectedService.trim() !== ""
    ) {
      unresolvedServiceNames.add(row.affectedService.trim());
    }
  }

  return {
    usableCount: partition.usable.length,
    unusableCount: partition.unusable.length,
    countsByReason,
    unresolvedPartnerNames: [...unresolvedPartnerNames].sort(),
    unresolvedServiceNames: [...unresolvedServiceNames].sort(),
    partnersWithZeroAttributedRows: PARTNERS.map((partner) => partner.id).filter((id) => !attributed.has(id)),
  };
}

export async function loadOutages(db: Database): Promise<OutagePartition> {
  const rows = await db.select().from(slaOutages);
  return partitionOutages(rows);
}
