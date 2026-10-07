import { BACKTEST_TRACKING_ONLY, CONTRACT_ON_FILE, MONTHLY_WINDOW, NO_TERMS, OUTSIDE_SCOPES, SETTLED_NOTE, TRACKING_ONLY_NOTE, UNAVAILABLE, VIEW_TERMS, formatMinutes } from "./copy";
import { termsLinkFor, type OverviewTile } from "./overview";
import type { PartnerView, Status, TermView, TrackingView } from "./view";

export type PartnerPageView = {
  id: string;
  name: string;
  worst: Status | null;
  trackingOnly: boolean;
  unavailable: boolean;
  failure: string | null;
  /** Mono meta segments, e.g. ["Merchant ID 151639", "3 terms"]. The terms link is separate. */
  meta: string[];
  termsLink: { label: string; href: string } | null;
  /** Null for business. */
  backtest: { enabled: boolean; windowKey: string; tooltip: string } | null;
  tiles: OverviewTile[];
  terms: TermView[];
  tracking: TrackingView[];
  trackingNote: string | null;
  trackingHeading: string;
  settledNote: string | null;
  windowKey: string;
};

export function buildPartnerPage(input: {
  partner: PartnerView;
  phase: "open" | "settled";
  windowKey: string;
  failure: string | null;
  role: "technical" | "business";
}): PartnerPageView {
  const { partner } = input;
  const atRisk = partner.terms.filter((term) => term.status !== "meeting").length;
  const breaching = partner.terms.filter((term) => term.status === "breaching").length;
  const used = partner.terms.reduce((sum, term) => sum + term.usedMinutes, 0);
  const allowed = partner.terms.reduce((sum, term) => sum + term.allowedMinutes, 0);
  const recorded = partner.tracking.reduce((sum, row) => sum + row.usedMinutes, 0);
  const noTerms = partner.terms.length === 0;
  // Business terms carry no ticket keys, so there is no honest count of covered outages.
  const ticketKeys = new Set<string>();
  for (const term of partner.terms) for (const ticket of term.tickets ?? []) ticketKeys.add(ticket.key);
  const hasTickets = partner.terms.every((term) => term.tickets !== null);
  const instances = ticketKeys.size;

  const tiles: OverviewTile[] = input.failure !== null
    ? ["Covered services", "At risk", "Breaching", "Downtime this window"].map((label) => ({ label, value: UNAVAILABLE, detail: null, tone: "muted", emphasis: false }))
    : [
        { label: "Covered services", value: noTerms ? NO_TERMS : String(partner.terms.length), detail: noTerms || !hasTickets ? null : `${instances} outage ${instances === 1 ? "instance" : "instances"}`, tone: noTerms ? "muted" : "neutral", emphasis: false },
        { label: "At risk", value: noTerms ? NO_TERMS : `${atRisk} / ${partner.terms.length}`, detail: null, tone: atRisk > 0 ? "warning" : noTerms ? "muted" : "neutral", emphasis: false },
        { label: "Breaching", value: noTerms ? NO_TERMS : String(breaching), detail: null, tone: breaching > 0 ? "danger" : noTerms ? "muted" : "neutral", emphasis: breaching > 0 },
        { label: "Downtime this window", value: formatMinutes(noTerms ? recorded : used), detail: noTerms ? null : `of ${allowed.toFixed(1)} min allowed`, tone: "neutral", emphasis: false },
      ];

  const termsLink = input.role === "technical" ? termsLinkFor(partner) : null;
  const termCount = `${partner.terms.length} ${partner.terms.length === 1 ? "term" : "terms"}`;
  const meta = input.role === "technical"
    ? [...(partner.merchantIds === null || partner.merchantIds.length === 0 ? [] : [`Merchant ID ${partner.merchantIds.join(", ")}`]), termCount]
    : [termCount, MONTHLY_WINDOW];

  return {
    id: partner.id,
    name: partner.name,
    worst: partner.worst,
    trackingOnly: partner.trackingOnly,
    unavailable: partner.unavailable,
    failure: input.failure,
    meta,
    termsLink: termsLink === null ? null : termsLink.label === VIEW_TERMS ? { label: CONTRACT_ON_FILE, href: termsLink.href } : termsLink,
    backtest: input.role === "technical" ? { enabled: partner.backtestEnabled, windowKey: input.windowKey, tooltip: BACKTEST_TRACKING_ONLY } : null,
    tiles,
    terms: partner.terms,
    tracking: partner.tracking,
    trackingNote: noTerms && !partner.unavailable ? TRACKING_ONLY_NOTE : null,
    trackingHeading: noTerms ? "Recorded downtime" : OUTSIDE_SCOPES,
    settledNote: input.phase === "settled" ? SETTLED_NOTE : null,
    windowKey: input.windowKey,
  };
}
