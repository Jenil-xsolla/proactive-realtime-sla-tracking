import { describe, expect, it } from "vitest";
import {
  captureMessage,
  correctedAfterJiraChangeNote,
  failureNotice,
  type SlackBlock,
} from "@/ingestion/notify/messages";
import type { CaptureRow } from "@/ingestion/resolution";

const PIR_KEY = "GTO-543";
const PIR_URL = "https://xsolla.atlassian.net/browse/GTO-543";

function row(overrides: Partial<CaptureRow> = {}): CaptureRow {
  return {
    pirKey: PIR_KEY,
    partner: "Scopely",
    partnerId: "151639",
    affectedService: "API",
    incidentStarted: new Date("2026-09-25T10:05:00.000Z"),
    outageMinutes: 45,
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

function sectionTexts(blocks: { type: string; text?: { text: string } }[]): string[] {
  return blocks.filter((b) => b.type === "section").map((b) => b.text!.text);
}

describe("captureMessage", () => {
  it("has the exact header line as the text fallback, and its heading as the first block line", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });

    expect(result.text).toBe(`${PIR_KEY} captured. It will appear on the dashboard.`);
    const firstSection = sectionTexts(result.blocks)[0];
    expect(firstSection.split("\n")[0]).toBe(
      `*<${PIR_URL}|${PIR_KEY}> captured.* It will appear on the dashboard.`,
    );
  });

  it("links the PIR key to pirUrl", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const firstSection = sectionTexts(result.blocks)[0];
    expect(firstSection).toContain(`<${PIR_URL}|${PIR_KEY}>`);
  });

  it("places the unresolved line before *Affected Partners*", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [{ kind: "merchant", raw: "Kabamster" }],
      nonPilotIdCount: 0,
    });
    const text = sectionTexts(result.blocks).join("\n");
    const unresolvedIndex = text.indexOf("Unresolved");
    const partnersIndex = text.indexOf("*Affected Partners:*");
    expect(unresolvedIndex).toBeGreaterThanOrEqual(0);
    expect(partnersIndex).toBeGreaterThan(unresolvedIndex);
  });

  it("heads the unresolved section so it stands out", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [{ kind: "merchant", raw: "Kabamster" }],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const unresolvedText = texts.find((t) => t.includes("Unresolved"));
    expect(unresolvedText).toMatch(/:warning:/);
    expect(unresolvedText).toContain("Unresolved");
  });

  it("shows a service_ari unresolved value as the trailing UUID after the last slash", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [
        {
          kind: "service_ari",
          raw: "ari:cloud:graph::service/00000000-0000-0000-0000-000000000001/1111-2222",
        },
      ],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const unresolvedText = texts.find((t) => t.includes("Unresolved"));
    expect(unresolvedText).toContain("1111-2222");
    expect(unresolvedText).not.toContain("ari:cloud:graph::service/00000000");
  });

  it("keeps the whole ARI when there is no slash", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [{ kind: "service_ari", raw: "no-slash-ari" }],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const unresolvedText = texts.find((t) => t.includes("Unresolved"));
    expect(unresolvedText).toContain("no-slash-ari");
  });

  it("renders the Affected Partners, Affected Service(s), Outage Minutes, Severity and Incident Started lines from the first row", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Affected Partners:* Scopely (151639)");
    expect(text).toContain("*Affected Service(s):* API");
    expect(text).toContain("*Outage Minutes:* 45");
    expect(text).toContain("*Severity:* L1 — Critical");
    expect(text).toContain("*Incident Started:* 2026-09-25 10:05 UTC");
  });

  it("shows an em dash for a missing partner_id", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row({ partnerId: null })],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Affected Partners:* Scopely (—)");
  });

  it("shows distinct partners and services in row order, comma-separated", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [
        row({ partner: "Scopely", partnerId: "151639", affectedService: "API" }),
        row({ partner: "Niantic", partnerId: "221437", affectedService: "Payments" }),
        row({ partner: "Scopely", partnerId: "151639", affectedService: "Payments" }),
      ],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Affected Partners:* Scopely (151639), Niantic (221437)");
    expect(text).toContain("*Affected Service(s):* API, Payments");
  });

  it("shows 'None attributed' and an em dash for services, with no minutes/severity/start lines, when there are zero rows", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Affected Partners:* None attributed");
    expect(text).toContain("*Affected Service(s):* —");
    expect(text).not.toContain("*Outage Minutes:*");
    expect(text).not.toContain("*Severity:*");
    expect(text).not.toContain("*Incident Started:*");
  });

  it("reports a non-zero non-pilot merchant ID count, pluralized", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 3,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Additional Comment:* 3 non-pilot merchant ID(s) ignored.");
  });

  it("uses the singular form for a non-pilot count of exactly 1", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 1,
    });
    const text = sectionTexts(result.blocks).join("\n");
    expect(text).toContain("*Additional Comment:* 1 non-pilot merchant ID ignored.");
  });

  it("omits the Additional Comment line when the non-pilot count is zero", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    expect(texts.some((t) => t.includes("Additional Comment"))).toBe(false);
  });

  it("has exactly one Correct button carrying the PIR key", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const actionsBlocks = result.blocks.filter(
      (b): b is Extract<SlackBlock, { type: "actions" }> => b.type === "actions",
    );
    const buttons = actionsBlocks.flatMap((b) => b.elements).filter((e) => e.type === "button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].action_id).toBe("correct");
    expect(buttons[0].value).toBe(PIR_KEY);
    expect(buttons[0].text.text).toBe("Correct");
  });

  it("adds the last-corrected footer only when lastCorrection is given", () => {
    const withoutCorrection = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    expect(withoutCorrection.blocks.some((b) => b.type === "context")).toBe(false);

    const withCorrection = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
      lastCorrection: { by: "j.patel", at: new Date("2026-09-25T14:30:00.000Z") },
    });
    const contextBlock = withCorrection.blocks.find(
      (b): b is Extract<SlackBlock, { type: "context" }> => b.type === "context",
    );
    expect(contextBlock).toBeDefined();
    expect(contextBlock!.elements[0].text).toContain("Last corrected by");
    expect(contextBlock!.elements[0].text).toContain("j.patel");
    expect(contextBlock!.elements[0].text).toContain("2026-09-25 14:30 UTC");
  });

  it("escapes Slack mrkdwn control characters in free text", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [{ kind: "merchant", raw: "<script>&alert" }],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const unresolvedText = texts.find((t) => t.includes("Unresolved"));
    expect(unresolvedText).not.toContain("<script>");
    expect(unresolvedText).toContain("&lt;script&gt;&amp;alert");
  });

  it("truncates a very long unresolved raw to 500 chars with an ellipsis, keeping every section under Slack's 3000-char limit", () => {
    const longRaw = "x".repeat(5000);
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [{ kind: "merchant", raw: longRaw }],
      nonPilotIdCount: 0,
    });
    for (const b of result.blocks) {
      if (b.type === "section") {
        expect(b.text.text.length).toBeLessThanOrEqual(3000);
      }
    }
    const texts = sectionTexts(result.blocks);
    const unresolvedText = texts.find((t) => t.includes("Unresolved"))!;
    expect(unresolvedText).toContain("…");
    expect(unresolvedText).toContain("x".repeat(500));
    expect(unresolvedText).not.toContain("x".repeat(501));
  });

  it("keeps every section under Slack's 3000-char limit and preserves partner order with many distinct partners", () => {
    const rows: CaptureRow[] = [];
    for (let p = 1; p <= 11; p += 1) {
      for (let s = 1; s <= 4; s += 1) {
        rows.push(
          row({
            partner: `Partner${String(p).padStart(2, "0")}`,
            partnerId: String(100000 + p),
            affectedService: `Service${s}`,
          }),
        );
      }
    }
    expect(rows.length).toBe(44);

    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows,
      unresolved: [],
      nonPilotIdCount: 0,
    });

    for (const b of result.blocks) {
      if (b.type === "section") {
        expect(b.text.text.length).toBeLessThanOrEqual(3000);
      }
    }

    const text = sectionTexts(result.blocks).join("\n");
    // The 11 distinct partners appear once each, in first-occurrence order.
    let cursor = -1;
    for (let p = 1; p <= 11; p += 1) {
      const marker = `Partner${String(p).padStart(2, "0")} (${100000 + p})`;
      const index = text.indexOf(marker, cursor + 1);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(text).toContain("*Affected Service(s):* Service1, Service2, Service3, Service4");
  });

  it("exactly matches the approved layout for a GTO-200-like input", () => {
    const gtoRows: CaptureRow[] = [
      { partner: "Scopely", partnerId: "151639" },
      { partner: "Niantic", partnerId: "221437" },
      { partner: "Bandai Namco", partnerId: "334455" },
      { partner: "Roblox", partnerId: "445566" },
      { partner: "Twitch", partnerId: "556677" },
      { partner: "Nexters", partnerId: "667788" },
      { partner: "Netmarble", partnerId: "778899" },
    ].map((overrides) =>
      row({
        ...overrides,
        affectedService: "Payments",
        outageMinutes: 25,
        severity: "L1 — Critical",
        incidentStarted: new Date("2026-07-24T04:15:00.000Z"),
      }),
    );

    const result = captureMessage({
      pirKey: "GTO-200",
      pirUrl: "https://xsolla.atlassian.net/browse/GTO-200",
      rows: gtoRows,
      unresolved: [],
      nonPilotIdCount: 1,
    });

    const firstSection = sectionTexts(result.blocks)[0];
    expect(firstSection).toBe(
      [
        "*<https://xsolla.atlassian.net/browse/GTO-200|GTO-200> captured.* It will appear on the dashboard.",
        "",
        "*Affected Partners:* Scopely (151639), Niantic (221437), Bandai Namco (334455), Roblox (445566), Twitch (556677), Nexters (667788), Netmarble (778899)",
        "*Affected Service(s):* Payments",
        "*Outage Minutes:* 25",
        "*Severity:* L1 — Critical",
        "*Incident Started:* 2026-07-24 04:15 UTC",
        "*Additional Comment:* 1 non-pilot merchant ID ignored.",
      ].join("\n"),
    );
  });

  it("mentions the PIR key exactly once, inside the heading link", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const firstSection = sectionTexts(result.blocks)[0];
    const link = `<${PIR_URL}|${PIR_KEY}>`;
    expect(firstSection).toContain(link);
    // Removing the one heading link should leave no other mention of the key
    // (PIR_URL itself contains the key as a substring, so a naive count
    // would over-count; strip the link first).
    const withoutLink = firstSection.replace(link, "");
    expect(withoutLink).not.toContain(PIR_KEY);
  });
});

describe("link guard", () => {
  it("falls back to the escaped label when the URL contains mrkdwn control characters", () => {
    const result = failureNotice({
      pirKey: 'GTO-<1>',
      pirUrl: "https://example.com/<bad>",
      error: "boom",
    });
    const allText = JSON.stringify(result.blocks);
    expect(allText).not.toContain("https://example.com/<bad>|");
    expect(allText).toContain("GTO-&lt;1&gt;");
  });

  it("falls back to the escaped label when the URL contains whitespace or a pipe", () => {
    const result = failureNotice({
      pirKey: PIR_KEY,
      pirUrl: "https://example.com/has space",
      error: "boom",
    });
    const allText = JSON.stringify(result.blocks);
    expect(allText).not.toContain("https://example.com/has space|");
  });

  it("still links a well-formed URL", () => {
    const result = failureNotice({ pirKey: PIR_KEY, pirUrl: PIR_URL, error: "boom" });
    const allText = JSON.stringify(result.blocks);
    expect(allText).toContain(`<${PIR_URL}|${PIR_KEY}>`);
  });
});

describe("failureNotice", () => {
  it("includes the linked PIR key and the error text, and has no actions block", () => {
    const result = failureNotice({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      error: "Jira fetch failed: <500> & timeout",
    });
    const allText = JSON.stringify(result.blocks);
    expect(allText).toContain(`<${PIR_URL}|${PIR_KEY}>`);
    expect(allText).toContain("Jira fetch failed: &lt;500&gt; &amp; timeout");
    expect(allText).not.toContain("<500>");
    expect(result.blocks.some((b) => b.type === "actions")).toBe(false);
  });

  it("caps a long error at 500 characters plus an ellipsis, keeping every section under Slack's 3000-char limit", () => {
    const longError = "insert into sla_outages ".repeat(500);
    const result = failureNotice({ pirKey: PIR_KEY, pirUrl: PIR_URL, error: longError });

    for (const block of result.blocks) {
      if (block.type === "section") {
        expect(block.text.text.length).toBeLessThanOrEqual(3000);
      }
    }
    const allText = JSON.stringify(result.blocks);
    expect(allText).toContain("…");
    expect(allText.length).toBeLessThan(longError.length);
  });
});

describe("correctedAfterJiraChangeNote", () => {
  it("notes that Jira changed after a correction and has no actions block", () => {
    const result = correctedAfterJiraChangeNote({ pirKey: PIR_KEY, pirUrl: PIR_URL });
    const allText = JSON.stringify(result.blocks);
    expect(allText).toContain(`<${PIR_URL}|${PIR_KEY}>`);
    expect(result.text.toLowerCase()).toContain("jira");
    expect(result.blocks.some((b) => b.type === "actions")).toBe(false);
  });
});
