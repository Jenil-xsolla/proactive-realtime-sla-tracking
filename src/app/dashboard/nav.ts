import type { PartnerView } from "./view";

export type Badge = { count: number } | { status: "error" } | null;
export type NavActive = { kind: "overview" } | { kind: "alerts" } | { kind: "health" } | { kind: "partner"; id: string };
export type NavTone = "breaching" | "at_risk" | "meeting" | "tracking" | "unknown";

export type NavModel = {
  windowKey: string;
  role: "technical" | "business";
  partners: { id: string; name: string; href: string; tone: NavTone }[];
  alerts: Badge;
  health: Badge;
  active: NavActive;
};

export function withWindow(path: string, windowKey: string): string {
  return `${path}?window=${encodeURIComponent(windowKey)}`;
}

function toneFor(partner: PartnerView): NavTone {
  if (partner.unavailable) return "unknown";
  if (partner.worst !== null) return partner.worst;
  return "tracking";
}

/** Built from the same PartnerView[] the page renders, so the two cannot disagree. */
export function buildNav(input: {
  windowKey: string;
  role: "technical" | "business";
  partners: readonly PartnerView[];
  alerts: Badge;
  health: Badge;
  active: NavActive;
}): NavModel {
  return {
    windowKey: input.windowKey,
    role: input.role,
    partners: input.partners.map((partner) => ({
      id: partner.id,
      name: partner.name,
      href: withWindow(`/partners/${partner.id}`, input.windowKey),
      tone: toneFor(partner),
    })),
    alerts: input.role === "business" ? null : input.alerts,
    health: input.role === "business" ? null : input.health,
    active: input.active,
  };
}
