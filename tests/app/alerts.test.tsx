import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertsPage } from "@/app/dashboard/alerts-page";
import { buildAlertsView } from "@/app/dashboard/alerts-view";
import { alertsBadge } from "@/app/dashboard/badges";
import { ALERTS_NOTE, ALERTS_UNAVAILABLE } from "@/app/dashboard/copy";
import { buildTechnicalPartners } from "@/app/dashboard/view";
import { scoredRow } from "../support/rows";

const months = [
  { key: "2026-09", title: "September 2026", phase: "open" as const, href: "/alerts?window=2026-09", selected: true },
  { key: "2026-08", title: "August 2026", phase: "settled" as const, href: "/alerts?window=2026-08", selected: false },
];
const at = (iso: string) => new Date(iso);
const rows = [
  { partnerSlug: "scopely", scopeId: "payments", period: "2026-09", lastStatus: "breaching", lastAlertedAt: at("2026-09-20T01:00:00Z"), alertCount: 2, updatedAt: at("2026-09-20T01:00:00Z") },
  { partnerSlug: "kabam", scopeId: "tracking:login", period: "2026-09", lastStatus: "heads_up", lastAlertedAt: at("2026-09-10T13:00:00Z"), alertCount: 1, updatedAt: at("2026-09-10T13:00:00Z") },
  { partnerSlug: "niantic", scopeId: "payments", period: "2026-09", lastStatus: "meeting", lastAlertedAt: null, alertCount: 0, updatedAt: at("2026-09-02T00:00:00Z") },
  { partnerSlug: "niantic", scopeId: "payments", period: "2026-08", lastStatus: "at_risk", lastAlertedAt: at("2026-08-15T01:00:00Z"), alertCount: 1, updatedAt: at("2026-08-15T01:00:00Z") },
];
const partners = buildTechnicalPartners([scoredRow()], "open", "2026-09", null);

describe("alerts page", () => {
  it("lists the selected month, titles scopes, and counts active alerts for the badge", () => {
    const view = buildAlertsView({ alerts: rows, filterKey: "2026-09", months, partners });
    if (view.state !== "ok") throw new Error("expected ok");
    expect(view.rows.map((row) => `${row.partner}:${row.scope}:${row.status}:${row.lastAlerted}`)).toEqual([
      "Scopely:Payments:Breaching:2026-09-20 01:00:00 UTC",
      "Kabam:Service: Login:Heads-up:2026-09-10 13:00:00 UTC",
      "Niantic:Payments:Meeting:Never",
    ]);
    expect(view.rows[0]?.href).toBe("/partners/scopely?window=2026-09");
    expect(view.filter.map((option) => option.label)).toEqual(["All months", "September 2026", "August 2026"]);
    expect(alertsBadge(rows, "2026-09")).toEqual({ count: 2 });
    const html = renderToStaticMarkup(<AlertsPage view={view} />);
    expect(html).toContain(ALERTS_NOTE);
    expect(html).toContain("Breaching");
    expect(html).not.toContain("—");
  });

  it("renders at_risk and breaching as StatusBadge and every other status as a neutral Chip", () => {
    const view = buildAlertsView({ alerts: rows, filterKey: "2026-09", months, partners });
    const html = renderToStaticMarkup(<AlertsPage view={view} />);
    const span = (label: string) => html.match(new RegExp(`<span class="[^"]*">${label}</span>`))?.[0] ?? "";
    expect(span("Breaching")).toContain("text-danger");
    const headsUp = span("Heads-up");
    expect(headsUp).not.toBe("");
    expect(headsUp).not.toContain("text-danger");
    expect(headsUp).not.toContain("text-warning");
    const meeting = span("Meeting");
    expect(meeting).not.toBe("");
    expect(meeting).not.toContain("text-danger");
    expect(meeting).not.toContain("text-warning");
    const august = buildAlertsView({ alerts: rows, filterKey: "2026-08", months, partners });
    expect(renderToStaticMarkup(<AlertsPage view={august} />)).toMatch(/<span class="[^"]*text-warning[^"]*">At risk<\/span>/);
  });

  it("marks only the selected filter link with aria-current", () => {
    const view = buildAlertsView({ alerts: rows, filterKey: "2026-09", months, partners });
    const html = renderToStaticMarkup(<AlertsPage view={view} />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/alerts\?window=2026-09" aria-current="page"[^>]*>September 2026<\/a>/);
    expect(html).toMatch(/<a href="\/alerts\?window=all"(?![^>]*aria-current)[^>]*>All months<\/a>/);
  });

  it("lists every month under All and writes the empty sentence for a quiet month", () => {
    const all = buildAlertsView({ alerts: rows, filterKey: "all", months, partners });
    expect(all.state === "ok" && all.rows).toHaveLength(4);
    const quiet = buildAlertsView({ alerts: rows, filterKey: "2026-07", months: [...months, { key: "2026-07", title: "July 2026", phase: "settled", href: "/alerts?window=2026-07", selected: false }], partners });
    expect(quiet.state === "ok" && quiet.empty).toBe("No alerts recorded for July 2026.");
    const html = renderToStaticMarkup(<AlertsPage view={quiet} />);
    expect(html).toContain("No alerts recorded for July 2026.");
    expect(html).not.toContain("<table");
  });

  it("renders the error state, never an empty list, when the read failed", () => {
    const view = buildAlertsView({ alerts: { status: "error" }, filterKey: "2026-09", months, partners });
    expect(view.state).toBe("error");
    const html = renderToStaticMarkup(<AlertsPage view={view} />);
    expect(html).toContain(ALERTS_UNAVAILABLE);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("No alerts recorded");
    expect(alertsBadge({ status: "error" }, "2026-09")).toEqual({ status: "error" });
  });
});
