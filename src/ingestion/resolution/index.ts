import type { UnresolvedValue } from "@/data";
import {
  PARTNERS,
  SERVICES,
  normalizeName,
  resolvePartner,
  resolveServiceAri,
  type PartnerId,
  type ServiceId,
} from "@/registry";

/**
 * Pure resolution of an extracted PIR's merchant text and service ARIs into
 * registry partners and services, plus the cross-product rows the writer
 * will store. No I/O: everything here is a deterministic lookup against the
 * registry (spec §2 step 4, decisions E1–E4).
 */

export type ResolvedPartner = {
  id: PartnerId;
  displayName: string;
  merchantId: string | null;
};

export type CaptureRow = {
  pirKey: string;
  partner: string;
  partnerId: string | null;
  affectedService: string;
  incidentStarted: Date;
  outageMinutes: number;
  severity: string;
  pirUrl: string;
};

const SERVICES_BY_ID = new Map(SERVICES.map((service) => [service.id, service]));

/** Every standalone digit run (`\b\d+\b`), matching E2's deterministic scan. */
const DIGIT_RUN = /\b\d+\b/g;

/**
 * Resolves a PIR's merchant text into pilot partners, a count of non-pilot
 * merchant IDs (E1 — ignored, never unresolved), and unresolved values (the
 * derived rule: text present but the scan found no partner and no digit run
 * at all).
 */
export function resolveMerchantText(text: string | null): {
  partners: ResolvedPartner[];
  nonPilotIdCount: number;
  unresolved: UnresolvedValue[];
} {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length === 0) {
    return { partners: [], nonPilotIdCount: 0, unresolved: [] };
  }

  // E2 ID scan: every standalone digit run is a merchant-ID candidate,
  // deduped. A run matching a registry merchantId resolves that partner
  // (with merchantId set to the run); an unmatched run is a non-pilot
  // merchant, counted but never unresolved.
  const digitRuns = new Set(trimmed.match(DIGIT_RUN) ?? []);
  const matchedById = new Map<PartnerId, string>();
  let nonPilotIdCount = 0;

  for (const run of digitRuns) {
    const result = resolvePartner({ merchantId: Number(run), name: "" });
    if (result.status === "resolved") {
      matchedById.set(result.id, run);
    } else {
      nonPilotIdCount += 1;
    }
  }

  // E2 name scan: every registry partner displayName/alias found at word
  // boundaries in the normalised text is a name match. A name match adds
  // the partner only when an ID didn't already add it.
  const normText = normalizeName(trimmed);
  const paddedText = ` ${normText} `;
  const matchedByName = new Set<PartnerId>();

  for (const partner of PARTNERS) {
    if (matchedById.has(partner.id)) {
      continue;
    }
    for (const label of [partner.displayName, ...partner.aliases]) {
      const normLabel = normalizeName(label);
      if (paddedText.includes(` ${normLabel} `)) {
        matchedByName.add(partner.id);
        break;
      }
    }
  }

  const matchedIds = new Set<PartnerId>([...matchedById.keys(), ...matchedByName]);
  const partners: ResolvedPartner[] = PARTNERS.filter((partner) => matchedIds.has(partner.id)).map(
    (partner) => {
      const byId = matchedById.get(partner.id);
      if (byId !== undefined) {
        return { id: partner.id, displayName: partner.displayName, merchantId: byId };
      }
      // A7: a name-only match gets the registry's single merchantId as a
      // string, or null when the partner has more than one.
      const merchantId = partner.merchantIds.length === 1 ? String(partner.merchantIds[0]) : null;
      return { id: partner.id, displayName: partner.displayName, merchantId };
    },
  );

  const unresolved: UnresolvedValue[] =
    partners.length === 0 && digitRuns.size === 0 ? [{ kind: "merchant", raw: trimmed }] : [];

  return { partners, nonPilotIdCount, unresolved };
}

/**
 * Resolves each affected-service ARI (customfield_10399) to its registry
 * service. An ARI missing from the registry is skipped and flagged as an
 * unresolved value (D6); it does not fail the PIR. Both lists are deduped,
 * keeping input order.
 */
export function resolveServiceAris(aris: string[]): {
  services: { id: ServiceId; displayName: string }[];
  unresolved: UnresolvedValue[];
} {
  const services: { id: ServiceId; displayName: string }[] = [];
  const seenServiceIds = new Set<ServiceId>();
  const unresolved: UnresolvedValue[] = [];
  const seenUnresolved = new Set<string>();

  for (const ari of aris) {
    const result = resolveServiceAri(ari);
    if (result.status === "resolved") {
      if (!seenServiceIds.has(result.id)) {
        seenServiceIds.add(result.id);
        const entry = SERVICES_BY_ID.get(result.id);
        if (entry !== undefined) {
          services.push({ id: result.id, displayName: entry.displayName });
        }
      }
    } else if (!seenUnresolved.has(ari)) {
      seenUnresolved.add(ari);
      unresolved.push({ kind: "service_ari", raw: ari });
    }
  }

  return { services, unresolved };
}

/**
 * Cross product of resolved partners and services (D2): one row per
 * (partner, service), identical apart from `affectedService`. Zero partners
 * or zero services yields no rows.
 */
export function buildCaptureRows(
  input: {
    pirKey: string;
    pirUrl: string;
    severity: string;
    outageMinutes: number;
    incidentStarted: Date;
  },
  partners: ResolvedPartner[],
  services: { id: ServiceId; displayName: string }[],
): CaptureRow[] {
  const rows: CaptureRow[] = [];

  for (const partner of partners) {
    for (const service of services) {
      rows.push({
        pirKey: input.pirKey,
        partner: partner.displayName,
        partnerId: partner.merchantId,
        affectedService: service.displayName,
        incidentStarted: input.incidentStarted,
        outageMinutes: input.outageMinutes,
        severity: input.severity,
        pirUrl: input.pirUrl,
      });
    }
  }

  return rows;
}
