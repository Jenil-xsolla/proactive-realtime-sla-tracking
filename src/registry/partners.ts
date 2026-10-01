import type { PartnerEntry } from "./types";

export const PARTNERS = [
  {
    id: "scopely",
    displayName: "Scopely",
    aliases: ["Scopely Inc"],
    merchantIds: [151639],
  },
  {
    id: "niantic",
    displayName: "Niantic",
    aliases: ["Niantic Inc"],
    merchantIds: [221437],
  },
  {
    id: "kabam",
    displayName: "Kabam",
    aliases: ["Kabam Inc"],
    merchantIds: [237137],
  },
  {
    id: "warner-brothers",
    displayName: "Warner Brothers",
    aliases: ["Warner Bros", "Warner Bros. Games", "Warner Brothers Games"],
    merchantIds: [169548],
  },
  {
    id: "bandai-namco",
    displayName: "Bandai Namco",
    aliases: ["BANDAI NAMCO", "Bandai Namco Entertainment", "Bandai Namco Entertainment Inc"],
    merchantIds: [503608],
  },
  {
    id: "second-dinner",
    displayName: "Second Dinner",
    aliases: ["SecondDinner"],
    merchantIds: [506855],
  },
  {
    id: "roblox",
    displayName: "Roblox",
    aliases: ["Roblox Corporation"],
    merchantIds: [38519],
  },
  {
    id: "twitch",
    displayName: "Twitch",
    aliases: ["Twitch Interactive"],
    merchantIds: [13132],
  },
  {
    id: "mihoyo",
    displayName: "miHoYo",
    aliases: ["Mihoyo", "HoYoverse", "miHoYo/HoYoverse", "Cognosphere"],
    merchantIds: [166973],
  },
  {
    id: "nexters",
    displayName: "Nexters",
    aliases: ["Nexters Global"],
    merchantIds: [60556],
  },
  {
    id: "netmarble",
    displayName: "Netmarble",
    aliases: ["Netmarble Corp", "Netmarble Corporation"],
    merchantIds: [207429],
  },
] as const satisfies readonly PartnerEntry[];

export type PartnerId = (typeof PARTNERS)[number]["id"];

export function isPartnerId(value: string): value is PartnerId {
  return PARTNERS.some((partner) => partner.id === value);
}
