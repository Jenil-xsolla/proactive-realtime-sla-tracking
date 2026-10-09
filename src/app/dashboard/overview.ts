import { ADD_CONTRACT_TERMS, DRAFT_TERMS, NO_TARGET_NOTE, SETTLED_NOTE, UNAVAILABLE, VIEW_TERMS, railLine, summaryLine } from "./copy";
import { withWindow } from "./nav";
import type { PartnerView, Status, TermView } from "./view";

export type OverviewTile = { label: string; value: string; detail: string | null; tone: "neutral" | "warning" | "danger" | "muted"; labelTone?: "success" | "warning" | "danger"; emphasis: boolean };
export type AttentionRow = { partnerId: string; partnerName: string; href: string; term: TermView };
export type RailCard = { id: string; name: string; href: string; worst: Status | null; line: string; termsLink: { label: string; href: string } | null; unavailable: boolean };
export type OverviewView = { summary: string; settledNote: string | null; failure: string | null; tiles: OverviewTile[]; attention: AttentionRow[]; rail: RailCard[] };

const RANK: Record<Status, number> = { meeting: 0, at_risk: 1, breached: 2 };

export function termsLinkFor(partner: PartnerView): { label: string; href: string } | null {
  const href = `/partners/${partner.id}/terms`;
  if (partner.contractTerms === "add") return { label: ADD_CONTRACT_TERMS, href };
  if (partner.contractTerms === "draft") return { label: DRAFT_TERMS, href };
  if (partner.contractTerms === "view") return { label: VIEW_TERMS, href };
  return null;
}

function countedMinutes(partner: PartnerView): number {
  return partner.terms.reduce((sum, term) => sum + term.usedMinutes, 0) + partner.tracking.reduce((sum, row) => sum + row.usedMinutes, 0);
}

/** Null when the count is unknown: business terms carry no outage records, so zero would be a false zero. */
function outageCount(partner: PartnerView): number | null {
  if (partner.terms.some((term) => term.tickets === null)) return null;
  const keys = new Set<string>();
  for (const term of partner.terms) for (const ticket of term.tickets ?? []) keys.add(ticket.key);
  for (const row of partner.tracking) for (const outage of row.outages ?? []) keys.add(outage.pirKey);
  if (keys.size > 0) return keys.size;
  // Business tracking rows carry counts, not keys.
  return partner.tracking.reduce((sum, row) => sum + row.outageCount, 0);
}

function consumed(term: TermView): number {
  return term.allowedMinutes > 0 ? term.usedMinutes / term.allowedMinutes : Number.POSITIVE_INFINITY;
}

function rank(partner: PartnerView): number {
  return partner.worst === null ? -1 : RANK[partner.worst];
}

export function buildOverview(input: {
  partners: readonly PartnerView[];
  phase: "open" | "settled";
  windowKey: string;
  failure: string | null;
  role: "technical" | "business";
}): OverviewView {
  const terms = input.partners.flatMap((partner) => partner.terms);
  const scoredPartners = input.partners.filter((partner) => partner.terms.length > 0).length;
  const trackingOnly = input.partners.filter((partner) => partner.terms.length === 0).length;
  const count = (status: Status) => terms.filter((term) => term.status === status).length;
  const breaching = count("breached");
  const atRisk = count("at_risk");

  const tiles: OverviewTile[] = input.failure !== null
    ? [
        { label: "Breached", value: UNAVAILABLE, detail: null, tone: "muted", labelTone: "danger", emphasis: false },
        { label: "At risk", value: UNAVAILABLE, detail: null, tone: "muted", labelTone: "warning", emphasis: false },
        { label: "Meeting", value: UNAVAILABLE, detail: null, tone: "muted", labelTone: "success", emphasis: false },
        { label: "Tracking only", value: UNAVAILABLE, detail: null, tone: "muted", emphasis: false },
      ]
    : [
        { label: "Breached", value: String(breaching), detail: null, tone: breaching > 0 ? "danger" : "neutral", labelTone: "danger", emphasis: breaching > 0 },
        { label: "At risk", value: String(atRisk), detail: null, tone: atRisk > 0 ? "warning" : "neutral", labelTone: "warning", emphasis: false },
        { label: "Meeting", value: String(count("meeting")), detail: null, tone: "neutral", labelTone: "success", emphasis: false },
        { label: "Tracking only", value: String(trackingOnly), detail: NO_TARGET_NOTE, tone: "muted", emphasis: false },
      ];

  const attention: AttentionRow[] = input.partners
    .flatMap((partner) =>
      partner.terms
        .filter((term) => term.status !== "meeting")
        .map((term) => ({ partnerId: partner.id, partnerName: partner.name, href: withWindow(`/partners/${partner.id}`, input.windowKey), term })),
    )
    .sort((left, right) => RANK[right.term.status] - RANK[left.term.status] || consumed(right.term) - consumed(left.term));

  const rail: RailCard[] = [...input.partners]
    .sort((left, right) => rank(right) - rank(left) || countedMinutes(right) - countedMinutes(left))
    .map((partner) => ({
      id: partner.id,
      name: partner.name,
      href: withWindow(`/partners/${partner.id}`, input.windowKey),
      worst: partner.worst,
      line: partner.unavailable
        ? UNAVAILABLE
        : railLine({ terms: partner.terms.length, outages: outageCount(partner), minutes: countedMinutes(partner), trackingOnly: partner.trackingOnly, services: partner.tracking.length }),
      termsLink: input.role === "technical" ? termsLinkFor(partner) : null,
      unavailable: partner.unavailable,
    }));

  return {
    summary: input.failure !== null ? "" : summaryLine(terms.length, scoredPartners, trackingOnly),
    settledNote: input.phase === "settled" ? SETTLED_NOTE : null,
    failure: input.failure,
    tiles,
    attention,
    rail,
  };
}
