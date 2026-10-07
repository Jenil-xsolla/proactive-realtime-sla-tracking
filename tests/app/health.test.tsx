import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import { healthBadge } from "@/app/dashboard/badges";
import { HEALTH_UNAVAILABLE, INGESTION_HEALTH_UNAVAILABLE, INGESTION_FAILED_LABEL, reasonLabel } from "@/app/dashboard/copy";
import { HealthPage } from "@/app/dashboard/health-page";
import { buildHealth, unusableRows } from "@/app/dashboard/model";
import type { SlaFeed } from "@/feed";

function feedHealth(): SlaFeed["health"] {
  return {
    usableCount: 27, unusableCount: 1,
    countsByReason: { ...Object.fromEntries(UNUSABLE_REASONS.map((reason) => [reason, 0])), missing_outage_minutes: 1 } as SlaFeed["health"]["countsByReason"],
    unresolvedPartnerNames: ["Unknown Co"], unresolvedServiceNames: [], partnersWithZeroAttributedRows: ["mihoyo"],
  };
}

const TILE_LABELS = ["Dropped rows", "Unresolved partners", "Unmatched services", "Partners with no rows"];

describe("health page", () => {
  it("shows tiles, the unusable rows table, and the badge sum excluding partners with no rows", () => {
    const health = buildHealth({
      health: feedHealth(),
      ingestion: { status: "ok", counts: { failed: 1, unresolved: 0, withoutMessage: 0 }, failed: [{ pirKey: "GTO-9", pirUrl: "https://jira.example/browse/GTO-9", error: "Jira fetch failed", updatedAt: "2026-09-01T00:00:00.000Z" }], unresolved: [], withoutMessage: [] },
      invalidTerms: [],
    });
    const rows = unusableRows([{ pirKey: "GTO-7", partner: "Scopely", partnerId: 151639, affectedService: "Payments", incidentStarted: "2026-09-03T10:00:00.000Z", rawOutageMinutes: null, reasons: ["missing_outage_minutes"] }]);
    expect(healthBadge(health)).toEqual({ count: 3 });
    const html = renderToStaticMarkup(<HealthPage health={health} unusable={rows} />);
    expect(html).toContain("<h1");
    for (const label of TILE_LABELS) expect(html).toContain(label);
    expect(html).toContain("<table");
    expect(html).toContain("GTO-7");
    expect(html).toMatch(/<td[^>]*>151639<\/td>/);
    expect(html).toContain(reasonLabel("missing_outage_minutes"));
    expect(html).toContain('href="https://jira.example/browse/GTO-9"');
    expect(html).toContain("Unknown Co");
    expect(html).toContain("miHoYo");
    expect(html).not.toContain("—");
  });

  it("renders an explicit error for a failed source, never a zero", () => {
    const html = renderToStaticMarkup(<HealthPage health={{ status: "error" }} unusable={null} />);
    expect(html).toContain(HEALTH_UNAVAILABLE);
    expect(html).toContain('role="alert"');
    expect(html).toContain("<h1");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).not.toContain("<table");
    const withoutAlertCopy = html.replace(HEALTH_UNAVAILABLE, "");
    for (const label of TILE_LABELS) expect(withoutAlertCopy).not.toContain(label);
    expect(healthBadge({ status: "error" })).toEqual({ status: "error" });
    const ingestionDown = buildHealth({ health: feedHealth(), ingestion: { status: "error" }, invalidTerms: [] });
    const ingestionHtml = renderToStaticMarkup(<HealthPage health={ingestionDown} unusable={[]} />);
    expect(ingestionHtml).toContain(INGESTION_HEALTH_UNAVAILABLE);
    expect(ingestionHtml).not.toContain(INGESTION_FAILED_LABEL);
    expect(healthBadge(ingestionDown)).toEqual({ status: "error" });
  });

  it("shows the unavailable alert in place of the unusable table while tiles still render", () => {
    const health = buildHealth({ health: feedHealth(), ingestion: { status: "error" }, invalidTerms: [] });
    const html = renderToStaticMarkup(<HealthPage health={health} unusable={null} />);
    expect(html).toContain(HEALTH_UNAVAILABLE);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<table");
    for (const label of TILE_LABELS) expect(html).toContain(label);
  });

  it("renders None for an empty unusable rows table", () => {
    const health = buildHealth({ health: feedHealth(), ingestion: { status: "ok", counts: { failed: 0, unresolved: 0, withoutMessage: 0 }, failed: [], unresolved: [], withoutMessage: [] }, invalidTerms: [] });
    const html = renderToStaticMarkup(<HealthPage health={health} unusable={[]} />);
    expect(html).not.toContain("<table");
    expect(html).toContain("None");
  });

  it("renders each ingestion list with a linked key, a plain key without a URL, and None for an empty list", () => {
    const health = buildHealth({
      health: feedHealth(),
      ingestion: {
        status: "ok",
        counts: { failed: 2, unresolved: 1, withoutMessage: 0 },
        failed: [
          { pirKey: "GTO-900", pirUrl: "https://jira.example/browse/GTO-900", error: "Jira fetch failed", updatedAt: "2026-09-20T00:00:00.000Z" },
          { pirKey: "GTO-901", pirUrl: null, error: "Missing incident link", updatedAt: "2026-09-19T00:00:00.000Z" },
        ],
        unresolved: [{ pirKey: "GTO-902", pirUrl: "https://jira.example/browse/GTO-902", values: [{ kind: "merchant", raw: "Some Unmatched Studio LLC" }] }],
        withoutMessage: [],
      },
      invalidTerms: [],
    });
    const html = renderToStaticMarkup(<HealthPage health={health} unusable={[]} />);
    expect(html).toContain('href="https://jira.example/browse/GTO-900"');
    expect(html).toContain("Jira fetch failed");
    expect(html).toContain(">GTO-901<");
    expect(html).toContain("Missing incident link");
    expect(html).not.toMatch(/<a[^>]*>GTO-901<\/a>/);
    expect(html).toContain(">GTO-902<");
    expect(html).toContain("Some Unmatched Studio LLC");
    expect(html).toContain("None");
  });
});
