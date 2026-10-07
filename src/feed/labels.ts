import { contractedServiceIds, PARTNERS, SEVERITIES, SERVICES } from "@/registry";

export type PilotPartner = {
  id: string;
  displayName: string;
};

export function listPilotPartners(): PilotPartner[] {
  return PARTNERS.map((partner) => ({
    id: partner.id,
    displayName: partner.displayName,
  }));
}

export function partnerLabel(id: string): string {
  return PARTNERS.find((partner) => partner.id === id)?.displayName ?? id;
}

export function serviceLabel(id: string): string {
  return SERVICES.find((service) => service.id === id)?.displayName ?? id;
}

export function severityLabel(id: string): string {
  return SEVERITIES.find((severity) => severity.id === id)?.displayName ?? id;
}

/** External merchant ids from the registry. Empty for an unknown id. Technical role only. */
export function partnerMerchantIds(id: string): number[] {
  return [...(PARTNERS.find((partner) => partner.id === id)?.merchantIds ?? [])];
}

/** Scope title from its contracted services, deduplicating a service already covered by one it names. */
export function scopeTitle(input: {
  services: readonly string[];
  includesScopedServices: boolean | null;
  scopeId: string;
}): string {
  if (input.services.length > 0) {
    return contractedServiceIds(input.services).map((service) => serviceLabel(service)).join(", ");
  }
  if (input.includesScopedServices === true) return "All services";
  if (input.includesScopedServices === false) return "General Scope";
  return input.scopeId;
}
