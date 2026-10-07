import { describe, expect, it } from "vitest";
import { getSlaFeed, getSlaHealth } from "@/feed";
import { AS_OF, INGESTION_PIR_KEY, PIR_KEY, WINDOW, businessFeedSources } from "../support/business-feed";

describe("business feed payload", () => {
  it("contains no PIR key anywhere in its serialised form for a scored fixture scope", async () => {
    const sources = businessFeedSources();
    const asOf = AS_OF;
    const window = WINDOW;
    const technical = JSON.stringify(
      await getSlaFeed({ asOf, window, viewer: { role: "technical" }, sources }),
    );
    const business = JSON.stringify(
      await getSlaFeed({ asOf, window, viewer: { role: "business" }, sources }),
    );

    expect(technical).toContain(PIR_KEY);
    expect(technical).toContain(INGESTION_PIR_KEY);
    expect(technical).toContain("FIXTURE — not a contract clause");
    expect(technical).toContain('"windowStart"');
    expect(business).not.toContain("FIXTURE — not a contract clause");
    expect(business).toContain('"kind":"scored"');
    expect(business).toContain('"partnerId":"scopely"');
    expect(business).toContain('"history":[');
    expect(business).toContain('"windowMinutes":');
    expect(business).toContain('"target":0.999');
    expect(business).toContain('"versusMedian":');
    expect(business).not.toContain(PIR_KEY);
    expect(business).not.toContain("151639");
    expect(business).not.toContain("ada");
    expect(business).not.toContain("ai_approved");
    expect(business).not.toContain("L1");
    expect(business).not.toContain(INGESTION_PIR_KEY);
  });

  it("keeps the ingestion PIR key out of the business health payload too", async () => {
    const sources = businessFeedSources();
    const asOf = AS_OF;

    const technicalHealth = JSON.stringify(
      await getSlaHealth({ asOf, viewer: { role: "technical" }, sources }),
    );
    const businessHealth = JSON.stringify(
      await getSlaHealth({ asOf, viewer: { role: "business" }, sources }),
    );

    expect(technicalHealth).toContain(INGESTION_PIR_KEY);
    expect(businessHealth).not.toContain(INGESTION_PIR_KEY);
    expect(businessHealth).not.toContain("Jira fetch failed");
  });
});
