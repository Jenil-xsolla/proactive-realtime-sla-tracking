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
  it("has the exact header line as both the first block line and the text fallback", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });

    expect(result.text).toBe(`${PIR_KEY} captured. It will appear on the dashboard.`);
    const firstSection = sectionTexts(result.blocks)[0];
    expect(firstSection.split("\n")[0]).toBe(`${PIR_KEY} captured. It will appear on the dashboard.`);
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

  it("places the unresolved section before any row content", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [{ kind: "merchant", raw: "Kabamster" }],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const unresolvedIndex = texts.findIndex((t) => t.includes("Unresolved"));
    const rowIndex = texts.findIndex((t) => t.includes("Scopely"));
    expect(unresolvedIndex).toBeGreaterThanOrEqual(0);
    expect(rowIndex).toBeGreaterThan(unresolvedIndex);
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

  it("renders one line per row: partner, partner_id, UTC start, service, minutes, severity", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const rowText = texts.find((t) => t.includes("Scopely"));
    expect(rowText).toContain("Scopely");
    expect(rowText).toContain("151639");
    expect(rowText).toContain("2026-09-25 10:05 UTC");
    expect(rowText).toContain("API");
    expect(rowText).toContain("45");
    expect(rowText).toContain("L1 — Critical");
  });

  it("shows an em dash for a missing partner_id", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row({ partnerId: null })],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    const rowText = texts.find((t) => t.includes("Scopely"));
    expect(rowText).toContain("—");
  });

  it("states that no pilot partner was attributed when there are zero rows", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    expect(texts.some((t) => /no pilot partner/i.test(t))).toBe(true);
  });

  it("reports a non-zero non-pilot merchant ID count", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 3,
    });
    const texts = sectionTexts(result.blocks);
    expect(texts.some((t) => t.includes("3 non-pilot merchant ID(s) ignored."))).toBe(true);
  });

  it("omits the non-pilot count line when it is zero", () => {
    const result = captureMessage({
      pirKey: PIR_KEY,
      pirUrl: PIR_URL,
      rows: [row()],
      unresolved: [],
      nonPilotIdCount: 0,
    });
    const texts = sectionTexts(result.blocks);
    expect(texts.some((t) => t.includes("non-pilot"))).toBe(false);
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
