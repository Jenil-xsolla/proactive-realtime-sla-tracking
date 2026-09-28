import { describe, expect, it } from "vitest";
import {
  PARTNERS,
  SEVERITIES,
  SERVICES,
  resolvePartner,
  resolveService,
  resolveServiceAri,
  resolveSeverity,
} from "@/registry";
import { buildServiceAriLookup } from "@/registry/resolve";

function byName(name: string) {
  return resolvePartner({ merchantId: null, name });
}

describe("partner registry", () => {
  it("lists each pilot partner once, under a stable slug", () => {
    expect(PARTNERS.map((partner) => [partner.id, partner.displayName])).toEqual([
      ["scopely", "Scopely"],
      ["niantic", "Niantic"],
      ["kabam", "Kabam"],
      ["warner-brothers", "Warner Brothers"],
      ["bandai-namco", "Bandai Namco"],
      ["second-dinner", "Second Dinner"],
      ["roblox", "Roblox"],
      ["twitch", "Twitch"],
      ["mihoyo", "miHoYo"],
      ["nexters", "Nexters"],
      ["netmarble", "Netmarble"],
    ]);
  });

  it("resolves realistic name variants to that slug", () => {
    const variants: Array<[string, string]> = [
      ["Scopely", "scopely"],
      ["  SCOPELY  ", "scopely"],
      ["Scopely, Inc.", "scopely"],
      ["Niantic", "niantic"],
      ["Kabam", "kabam"],
      ["Warner Brothers", "warner-brothers"],
      ["warner bros.", "warner-brothers"],
      ["  WARNER   BROS.  ", "warner-brothers"],
      ["Bandai Namco", "bandai-namco"],
      ["BANDAI NAMCO Entertainment", "bandai-namco"],
      ["Second Dinner", "second-dinner"],
      ["SecondDinner", "second-dinner"],
      ["Roblox", "roblox"],
      ["Twitch", "twitch"],
      ["miHoYo", "mihoyo"],
      ["Mihoyo", "mihoyo"],
      ["HoYoverse", "mihoyo"],
      ["Nexters", "nexters"],
      ["Netmarble", "netmarble"],
      ["Netmarble Corporation", "netmarble"],
    ];

    for (const [raw, id] of variants) {
      expect(byName(raw), raw).toEqual({ status: "resolved", id });
    }
  });

  it("returns unresolved instead of guessing a nearby name", () => {
    for (const raw of ["Warner", "WB", "Namco", "Sco", "", "   ", "Not a partner"]) {
      expect(byName(raw), raw).toEqual({ status: "unresolved", raw });
    }
  });

  it("stores each pilot merchant id on its partner", () => {
    expect(PARTNERS.map((partner) => [partner.id, partner.merchantIds])).toEqual([
      ["scopely", [151639]],
      ["niantic", [221437]],
      ["kabam", [237137]],
      ["warner-brothers", [169548]],
      ["bandai-namco", [503608]],
      ["second-dinner", [506855]],
      ["roblox", [38519]],
      ["twitch", [13132]],
      ["mihoyo", [166973]],
      ["nexters", [60556]],
      ["netmarble", [207429]],
    ]);
  });

  it("resolves partner_id first and uses the name only when the id is absent", () => {
    expect(resolvePartner({ merchantId: 506855, name: "Kabam" })).toEqual({
      status: "resolved",
      id: "second-dinner",
    });
    expect(resolvePartner({ merchantId: null, name: "Kabam" })).toEqual({
      status: "resolved",
      id: "kabam",
    });
    expect(resolvePartner({ merchantId: 191692, name: "Scopely" })).toEqual({
      status: "unresolved",
      raw: "191692",
    });
  });
});

describe("service registry", () => {
  it("lists each service once, under a stable slug", () => {
    expect(SERVICES.map((service) => [service.id, service.displayName])).toEqual([
      ["80lv", "80lv"],
      ["afs", "AFS"],
      ["chat-platform", "ChatPlatform"],
      ["concourse", "Concourse"],
      ["corp-site", "CorpSite"],
      ["funding-club", "Funding Club"],
      ["gamers-platform", "GamersPlatform"],
      ["igs-bb", "IGS-BB"],
      ["infrastructure", "Infrastructure"],
      ["launcher", "Launcher"],
      ["lightstream", "Lightstream"],
      ["live-ops", "LiveOps"],
      ["login", "Login"],
      ["monetization-fronted", "Monetization Fronted"],
      ["monetization-integration", "Monetization Integration"],
      ["payments", "Payments"],
      ["publisher-account", "Publisher Account"],
      ["rainmaker", "Rainmaker"],
      ["sdk", "SDK"],
      ["shop-builder", "Shop Builder"],
      ["slemma", "Slemma"],
      ["subscriptions", "Subscriptions"],
      ["unknown", "Unknown"],
      ["user-engagement", "UserEngagement"],
      ["webshop", "Webshop"],
      ["xsolla-analytics", "Xsolla Analytics"],
      ["xsolla-id", "Xsolla ID"],
      ["xsolla-mall", "Xsolla Mall"],
      ["xsolla-partner-network", "Xsolla Partner Network"],
      ["xsolla-pay", "Xsolla Pay"],
      ["xsolla-rewards", "Xsolla Rewards"],
      ["xsolla-stack", "Xsolla Stack"],
    ]);
  });

  it("resolves realistic service name variants to that slug", () => {
    const variants: Array<[string, string]> = [
      ["80lv", "80lv"],
      ["afs", "afs"],
      ["Chat Platform", "chat-platform"],
      ["  IGS-BB  ", "igs-bb"],
      ["igs bb", "igs-bb"],
      ["login", "login"],
      ["PAYMENTS", "payments"],
      ["shop-builder", "shop-builder"],
      ["ShopBuilder", "shop-builder"],
      ["Unknown", "unknown"],
      ["Web Shop", "webshop"],
      ["xsolla id", "xsolla-id"],
      ["XsollaPay", "xsolla-pay"],
    ];

    for (const [raw, id] of variants) {
      expect(resolveService(raw), raw).toEqual({ status: "resolved", id });
    }
  });

  it("returns unresolved instead of guessing a nearby service", () => {
    for (const raw of ["Pay", "Store", "IGS", "Shop", "Pay Station", "", "   !!! "]) {
      expect(resolveService(raw), raw).toEqual({ status: "unresolved", raw });
    }
  });
});

describe("service ARI registry", () => {
  // Copied verbatim from n8n workflow ayGR5EibR4xQOf45, node "ARI to ServiceName
  // Mapping" (see .superpowers/sdd/2026-09-28-ingestion-in-app-plan/n8n-ari-map.json).
  // This table is independent of src/registry/services.ts so it pins the registry
  // against the original n8n source rather than against itself.
  const N8N_ARI_MAP: Record<string, string> = {
    "33eed602-87e4-11ec-897c-128b42819424": "80lv",
    "a44d02ba-865e-11ed-8d10-128b42819424": "AFS",
    "00f6a338-f4c9-11ef-8e10-0afff3dd3477": "ChatPlatform",
    "6eec1de6-0e1a-11ef-89f2-128b42819424": "Concourse",
    "0ba99b24-d00a-11eb-a1f5-0abe3f4a6601": "CorpSite",
    "ef11eb32-c911-11eb-a433-128b42819424": "Funding Club",
    "c242a5a2-5295-11ec-8be4-0abe3f4a6601": "GamersPlatform",
    "2201284c-d00a-11eb-8ed1-0abe3f4a6601": "IGS-BB",
    "8682c9fa-53ff-11ec-a843-0abe3f4a6601": "Infrastructure",
    "22946160-53ff-11ec-8f03-0abe3f4a6601": "Launcher",
    "85474126-45f8-11f0-8090-122fa60ab53d": "Lightstream",
    "e5f1d97e-7125-11f1-9674-0affcf0fbd09": "LiveOps",
    "c5175e66-f454-11eb-b601-0abe3f4a6601": "Login",
    "10c9333a-9420-11ee-9083-0abe3f4a6601": "Monetization Fronted",
    "a91765ae-6df3-11f0-b1ab-0affec4791ff": "Monetization Integration",
    "271a0cee-45d2-11f0-81c7-122fa60ab53d": "Payments",
    "0590a1d8-5296-11ec-a000-0abe3f4a6601": "Publisher Account",
    "7ad984f6-45f8-11f0-a9d8-122fa60ab53d": "Rainmaker",
    "f9ba401a-4a96-11f0-9ff1-122fa60ab53d": "SDK",
    "8aa207e8-1468-11ec-a27a-0abe3f4a6601": "Shop Builder",
    "5f9eb4bc-3ec8-11ec-bf4f-0abe3f4a6601": "Slemma",
    "99a98f9c-e57b-11ec-a637-0abe3f4a6601": "Subscriptions",
    "47d6f258-4b68-11f0-ae6e-122fa60ab53d": "Unknown",
    "43502dac-87e5-11ec-a967-128b42819424": "UserEngagement",
    "c0e5c220-2cde-11f1-be25-122ebd4873cf": "Webshop",
    "0816ccb2-cd9d-11eb-a40c-128b42819424": "Xsolla Analytics",
    "2d75b96e-8cc4-11f1-8b08-122ebd4873cf": "Xsolla ID",
    "178246c6-5296-11ec-bea7-0abe3f4a6601": "Xsolla Mall",
    "3c8357fc-53ff-11ec-8f0a-0abe3f4a6601": "Xsolla Partner Network",
    "11a6bdaa-f453-11eb-b4b1-0abe3f4a6601": "Xsolla Pay",
    "f18425b4-87e4-11ec-aa12-128b42819424": "Xsolla Rewards",
    "dceb1e8e-1640-11f1-b300-122ebd4873cf": "Xsolla Stack",
  };

  it("has exactly 32 pairs copied from n8n", () => {
    expect(Object.keys(N8N_ARI_MAP)).toHaveLength(32);
  });

  it("resolves a bare UUID", () => {
    expect(resolveServiceAri("271a0cee-45d2-11f0-81c7-122fa60ab53d")).toEqual({
      status: "resolved",
      id: "payments",
    });
  });

  it("resolves a full ARI, taking the segment after the last slash", () => {
    expect(
      resolveServiceAri("ari:cloud:jira::site/271a0cee-45d2-11f0-81c7-122fa60ab53d"),
    ).toEqual({ status: "resolved", id: "payments" });
  });

  it("trims and lowercases the extracted segment before lookup", () => {
    expect(resolveServiceAri("  271A0CEE-45D2-11F0-81C7-122FA60AB53D  ")).toEqual({
      status: "resolved",
      id: "payments",
    });
  });

  it("returns unresolved with raw equal to the UUID for an unknown UUID", () => {
    const unknown = "00000000-0000-0000-0000-000000000000";
    expect(resolveServiceAri(unknown)).toEqual({ status: "unresolved", raw: unknown });
  });

  it("is unresolved for an empty input", () => {
    expect(resolveServiceAri("")).toEqual({ status: "unresolved", raw: "" });
  });

  it("gives every SERVICES entry at least one ARI", () => {
    for (const service of SERVICES) {
      expect(service.aris.length, service.id).toBeGreaterThan(0);
    }
  });

  it("maps every n8n ARI to the service with that display name", () => {
    for (const [uuid, displayName] of Object.entries(N8N_ARI_MAP)) {
      const service = SERVICES.find((entry) => entry.displayName === displayName);
      expect(service, displayName).toBeDefined();
      expect(resolveServiceAri(uuid), displayName).toEqual({
        status: "resolved",
        id: service?.id,
      });
    }
  });

  it("throws at build time when a UUID is mapped to two services", () => {
    expect(() =>
      buildServiceAriLookup([
        { id: "a", aris: ["dupe-uuid"] },
        { id: "b", aris: ["dupe-uuid"] },
      ]),
    ).toThrow();
  });
});

describe("severity registry", () => {
  it("lists each severity once, under a stable slug", () => {
    expect(SEVERITIES.map((severity) => [severity.id, severity.displayName])).toEqual([
      ["l0", "L0 — Catastrophic"],
      ["l1", "L1 — Critical"],
      ["l2", "L2 — Major"],
    ]);
  });

  it("resolves realistic severity labels to that slug", () => {
    const variants: Array<[string, string]> = [
      ["L0 — Catastrophic", "l0"],
      ["L1 — Critical", "l1"],
      ["L2 — Major", "l2"],
      ["L1", "l1"],
      ["  l1 - critical  ", "l1"],
      ["1 Level", "l1"],
      ["0 Level", "l0"],
      ["2 Level", "l2"],
    ];

    for (const [raw, id] of variants) {
      expect(resolveSeverity(raw), raw).toEqual({ status: "resolved", id });
    }
  });

  it("returns unresolved instead of guessing a nearby severity", () => {
    for (const raw of ["Critical", "L3", "L9 — Minor", "", "   "]) {
      expect(resolveSeverity(raw), raw).toEqual({ status: "unresolved", raw });
    }
  });
});
