import { describe, expect, it } from "vitest";
import {
  buildCaptureRows,
  resolveMerchantText,
  resolveServiceAris,
} from "@/ingestion/resolution";
import { readPir } from "@/ingestion/jira/extract";
import gto200 from "../fixtures/jira/GTO-200.pir.json";

const baseUrl = "https://xsolla.atlassian.net";

describe("resolveMerchantText", () => {
  it("resolves by merchant ID", () => {
    const result = resolveMerchantText("151639");
    expect(result.partners).toEqual([{ id: "scopely", displayName: "Scopely", merchantId: "151639" }]);
    expect(result.nonPilotIdCount).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("resolves by display name (A7: single merchant id, used as string)", () => {
    const result = resolveMerchantText("Scopely");
    expect(result.partners).toEqual([{ id: "scopely", displayName: "Scopely", merchantId: "151639" }]);
    expect(result.nonPilotIdCount).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("resolves by alias", () => {
    const result = resolveMerchantText("Warner Bros. Games");
    expect(result.partners).toEqual([
      { id: "warner-brothers", displayName: "Warner Brothers", merchantId: "169548" },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("is case- and punctuation-insensitive", () => {
    const result = resolveMerchantText("NETMARBLE CORPORATION");
    expect(result.partners).toEqual([
      { id: "netmarble", displayName: "Netmarble", merchantId: "207429" },
    ]);
  });

  it("matches a sub-brand at word boundaries", () => {
    expect(resolveMerchantText("Scopely | TopHat").partners).toEqual([
      { id: "scopely", displayName: "Scopely", merchantId: "151639" },
    ]);
    expect(resolveMerchantText("Twitch TV").partners).toEqual([
      { id: "twitch", displayName: "Twitch", merchantId: "13132" },
    ]);
  });

  it("does not match an alias inside a longer word", () => {
    const result = resolveMerchantText("Kabamster");
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(0);
    expect(result.unresolved).toEqual([{ kind: "merchant", raw: "Kabamster" }]);
  });

  it("counts a non-pilot ID rather than flagging it unresolved", () => {
    const result = resolveMerchantText("859921");
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  it("dedupes a repeated non-pilot ID to a distinct count", () => {
    const result = resolveMerchantText("859921, 859921");
    expect(result.nonPilotIdCount).toBe(1);
  });

  it("counts the same partner once when matched by both ID and name, keeping the ID's merchantId", () => {
    const result = resolveMerchantText("Scopely 151639");
    expect(result.partners).toEqual([{ id: "scopely", displayName: "Scopely", merchantId: "151639" }]);
  });

  it("records free text with no partner and no digit run as one unresolved value", () => {
    const result = resolveMerchantText("All merchants");
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(0);
    expect(result.unresolved).toEqual([{ kind: "merchant", raw: "All merchants" }]);
  });

  it("records another no-match, no-digit phrase as unresolved", () => {
    const raw = "None. No merchant or partner was affected by this incident.";
    const result = resolveMerchantText(raw);
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(0);
    expect(result.unresolved).toEqual([{ kind: "merchant", raw }]);
  });

  it("text with only non-pilot IDs yields zero partners, a count, and nothing unresolved", () => {
    const result = resolveMerchantText("859921");
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  it("null yields nothing", () => {
    expect(resolveMerchantText(null)).toEqual({ partners: [], nonPilotIdCount: 0, unresolved: [] });
  });

  it("blank text behaves like null", () => {
    expect(resolveMerchantText("   ")).toEqual({ partners: [], nonPilotIdCount: 0, unresolved: [] });
  });

  it("GTO-200's merchant text resolves exactly its pilot partners, in registry order", () => {
    const read = readPir(gto200, baseUrl);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    const result = resolveMerchantText(read.value.merchantText);
    expect(result.partners.map((p) => p.id)).toEqual([
      "scopely",
      "niantic",
      "bandai-namco",
      "roblox",
      "twitch",
      "nexters",
      "netmarble",
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("GTO-1624-style text: 44 non-pilot merchant IDs, none of them pilot, no unresolved value", () => {
    const nonPilotIds = Array.from({ length: 44 }, (_, i) => 900001 + i);
    const raw = nonPilotIds.join(", ");
    const result = resolveMerchantText(raw);
    expect(result.partners).toEqual([]);
    expect(result.nonPilotIdCount).toBe(44);
    expect(result.unresolved).toEqual([]);
  });
});

describe("resolveServiceAris", () => {
  it("resolves a known ARI", () => {
    const result = resolveServiceAris([
      "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/2201284c-d00a-11eb-8ed1-0abe3f4a6601",
    ]);
    expect(result.services).toEqual([{ id: "igs-bb", displayName: "IGS-BB" }]);
    expect(result.unresolved).toEqual([]);
  });

  it("flags an unknown ARI as a service_ari unresolved value", () => {
    const raw = "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/00000000-0000-0000-0000-000000000000";
    const result = resolveServiceAris([raw]);
    expect(result.services).toEqual([]);
    expect(result.unresolved).toEqual([{ kind: "service_ari", raw }]);
  });

  it("dedupes both lists while keeping input order", () => {
    const known = "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/2201284c-d00a-11eb-8ed1-0abe3f4a6601";
    const unknown = "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/00000000-0000-0000-0000-000000000000";
    const result = resolveServiceAris([known, unknown, known, unknown]);
    expect(result.services).toEqual([{ id: "igs-bb", displayName: "IGS-BB" }]);
    expect(result.unresolved).toEqual([{ kind: "service_ari", raw: unknown }]);
  });
});

describe("buildCaptureRows", () => {
  const base = {
    pirKey: "GTO-1",
    pirUrl: "https://xsolla.atlassian.net/browse/GTO-1",
    severity: "L1 — Critical",
    outageMinutes: 10,
    incidentStarted: new Date("2026-01-01T00:00:00Z"),
  };

  it("is the cross product of partners and services", () => {
    const partners = [
      { id: "scopely" as const, displayName: "Scopely", merchantId: "151639" },
      { id: "niantic" as const, displayName: "Niantic", merchantId: null },
    ];
    const services = [
      { id: "igs-bb" as const, displayName: "IGS-BB" },
      { id: "payments" as const, displayName: "Payments" },
    ];
    const rows = buildCaptureRows(base, partners, services);
    expect(rows).toHaveLength(4);
    expect(rows).toEqual([
      { ...base, partner: "Scopely", partnerId: "151639", affectedService: "IGS-BB" },
      { ...base, partner: "Scopely", partnerId: "151639", affectedService: "Payments" },
      { ...base, partner: "Niantic", partnerId: null, affectedService: "IGS-BB" },
      { ...base, partner: "Niantic", partnerId: null, affectedService: "Payments" },
    ]);
  });

  it("is empty when there are zero partners", () => {
    const services = [{ id: "igs-bb" as const, displayName: "IGS-BB" }];
    expect(buildCaptureRows(base, [], services)).toEqual([]);
  });

  it("is empty when there are zero services", () => {
    const partners = [{ id: "scopely" as const, displayName: "Scopely", merchantId: "151639" }];
    expect(buildCaptureRows(base, partners, [])).toEqual([]);
  });
});
