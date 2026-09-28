import type { ServiceEntry } from "./types";

/**
 * Flat catalog of services that appear on outage records.
 * Parent/child relationships are not recorded here.
 * Aliases are spacing variants of the same name, not other products.
 *
 * `aris` are the bare lowercase Jira ARI UUIDs (customfield_10399) for the
 * service, copied verbatim from n8n workflow ayGR5EibR4xQOf45, node "ARI to
 * ServiceName Mapping".
 */
export const SERVICES = [
  { id: "80lv", displayName: "80lv", aliases: [], aris: ["33eed602-87e4-11ec-897c-128b42819424"] },
  { id: "afs", displayName: "AFS", aliases: [], aris: ["a44d02ba-865e-11ed-8d10-128b42819424"] },
  {
    id: "chat-platform",
    displayName: "ChatPlatform",
    aliases: ["Chat Platform"],
    aris: ["00f6a338-f4c9-11ef-8e10-0afff3dd3477"],
  },
  {
    id: "concourse",
    displayName: "Concourse",
    aliases: [],
    aris: ["6eec1de6-0e1a-11ef-89f2-128b42819424"],
  },
  {
    id: "corp-site",
    displayName: "CorpSite",
    aliases: ["Corp Site"],
    aris: ["0ba99b24-d00a-11eb-a1f5-0abe3f4a6601"],
  },
  {
    id: "funding-club",
    displayName: "Funding Club",
    aliases: ["FundingClub"],
    aris: ["ef11eb32-c911-11eb-a433-128b42819424"],
  },
  {
    id: "gamers-platform",
    displayName: "GamersPlatform",
    aliases: ["Gamers Platform"],
    aris: ["c242a5a2-5295-11ec-8be4-0abe3f4a6601"],
  },
  {
    id: "igs-bb",
    displayName: "IGS-BB",
    aliases: [],
    aris: ["2201284c-d00a-11eb-8ed1-0abe3f4a6601"],
  },
  {
    id: "infrastructure",
    displayName: "Infrastructure",
    aliases: [],
    aris: ["8682c9fa-53ff-11ec-a843-0abe3f4a6601"],
  },
  {
    id: "launcher",
    displayName: "Launcher",
    aliases: [],
    aris: ["22946160-53ff-11ec-8f03-0abe3f4a6601"],
  },
  {
    id: "lightstream",
    displayName: "Lightstream",
    aliases: [],
    aris: ["85474126-45f8-11f0-8090-122fa60ab53d"],
  },
  {
    id: "live-ops",
    displayName: "LiveOps",
    aliases: ["Live Ops"],
    aris: ["e5f1d97e-7125-11f1-9674-0affcf0fbd09"],
  },
  { id: "login", displayName: "Login", aliases: [], aris: ["c5175e66-f454-11eb-b601-0abe3f4a6601"] },
  {
    id: "monetization-fronted",
    displayName: "Monetization Fronted",
    aliases: ["MonetizationFronted"],
    aris: ["10c9333a-9420-11ee-9083-0abe3f4a6601"],
  },
  {
    id: "monetization-integration",
    displayName: "Monetization Integration",
    aliases: ["MonetizationIntegration"],
    aris: ["a91765ae-6df3-11f0-b1ab-0affec4791ff"],
  },
  {
    id: "payments",
    displayName: "Payments",
    aliases: [],
    aris: ["271a0cee-45d2-11f0-81c7-122fa60ab53d"],
  },
  {
    id: "publisher-account",
    displayName: "Publisher Account",
    aliases: ["PublisherAccount"],
    aris: ["0590a1d8-5296-11ec-a000-0abe3f4a6601"],
  },
  {
    id: "rainmaker",
    displayName: "Rainmaker",
    aliases: [],
    aris: ["7ad984f6-45f8-11f0-a9d8-122fa60ab53d"],
  },
  { id: "sdk", displayName: "SDK", aliases: [], aris: ["f9ba401a-4a96-11f0-9ff1-122fa60ab53d"] },
  {
    id: "shop-builder",
    displayName: "Shop Builder",
    aliases: ["ShopBuilder"],
    aris: ["8aa207e8-1468-11ec-a27a-0abe3f4a6601"],
  },
  {
    id: "slemma",
    displayName: "Slemma",
    aliases: [],
    aris: ["5f9eb4bc-3ec8-11ec-bf4f-0abe3f4a6601"],
  },
  {
    id: "subscriptions",
    displayName: "Subscriptions",
    aliases: [],
    aris: ["99a98f9c-e57b-11ec-a637-0abe3f4a6601"],
  },
  {
    id: "unknown",
    displayName: "Unknown",
    aliases: [],
    aris: ["47d6f258-4b68-11f0-ae6e-122fa60ab53d"],
  },
  {
    id: "user-engagement",
    displayName: "UserEngagement",
    aliases: ["User Engagement"],
    aris: ["43502dac-87e5-11ec-a967-128b42819424"],
  },
  {
    id: "webshop",
    displayName: "Webshop",
    aliases: ["Web Shop"],
    aris: ["c0e5c220-2cde-11f1-be25-122ebd4873cf"],
  },
  {
    id: "xsolla-analytics",
    displayName: "Xsolla Analytics",
    aliases: ["XsollaAnalytics"],
    aris: ["0816ccb2-cd9d-11eb-a40c-128b42819424"],
  },
  {
    id: "xsolla-id",
    displayName: "Xsolla ID",
    aliases: ["XsollaID"],
    aris: ["2d75b96e-8cc4-11f1-8b08-122ebd4873cf"],
  },
  {
    id: "xsolla-mall",
    displayName: "Xsolla Mall",
    aliases: ["XsollaMall"],
    aris: ["178246c6-5296-11ec-bea7-0abe3f4a6601"],
  },
  {
    id: "xsolla-partner-network",
    displayName: "Xsolla Partner Network",
    aliases: ["XsollaPartnerNetwork"],
    aris: ["3c8357fc-53ff-11ec-8f0a-0abe3f4a6601"],
  },
  {
    id: "xsolla-pay",
    displayName: "Xsolla Pay",
    aliases: ["XsollaPay"],
    aris: ["11a6bdaa-f453-11eb-b4b1-0abe3f4a6601"],
  },
  {
    id: "xsolla-rewards",
    displayName: "Xsolla Rewards",
    aliases: ["XsollaRewards"],
    aris: ["f18425b4-87e4-11ec-aa12-128b42819424"],
  },
  {
    id: "xsolla-stack",
    displayName: "Xsolla Stack",
    aliases: ["XsollaStack"],
    aris: ["dceb1e8e-1640-11f1-b300-122ebd4873cf"],
  },
] as const satisfies readonly ServiceEntry[];

export type ServiceId = (typeof SERVICES)[number]["id"];
