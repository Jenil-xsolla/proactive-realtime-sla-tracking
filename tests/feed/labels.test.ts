import { describe, expect, it } from "vitest";
import { partnerMerchantIds } from "@/feed";

describe("partnerMerchantIds", () => {
  it("returns the registry merchant ids for a pilot partner and nothing for an unknown id", () => {
    expect(partnerMerchantIds("scopely")).toEqual([151639]);
    expect(partnerMerchantIds("not-a-partner")).toEqual([]);
  });
});
