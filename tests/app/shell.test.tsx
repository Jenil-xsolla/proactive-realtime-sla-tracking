import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNav, withWindow } from "@/app/dashboard/nav";
import { Shell } from "@/app/shell/shell";
import { unavailablePartners, type PartnerView } from "@/app/dashboard/view";

function partner(id: string, name: string, overrides: Partial<PartnerView> = {}): PartnerView {
  return {
    id, name, merchantIds: null, terms: [], tracking: [], worst: null, trackingOnly: true, unavailable: false,
    contractTerms: null, backtestEnabled: false, ...overrides,
  };
}

const frame = {
  windowKey: "2026-09",
  windowTitle: "September 2026",
  phase: "open" as const,
  months: [{ key: "2026-09", title: "September 2026", phase: "open" as const, href: "/?window=2026-09", selected: true }],
  asOfLabel: "2026-09-23 15:58:00 UTC",
  chip: { label: "No rows dropped", tone: "neutral" as const, href: "/health" },
};

/** Opening tags of the anchors inside the sidebar <nav>, so the month menu's own links cannot match. */
function sidebarAnchors(html: string): string[] {
  const nav = /<nav[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return nav.match(/<a [^>]*>/g) ?? [];
}

function sidebarAnchor(html: string, href: string): string | undefined {
  return sidebarAnchors(html).find((tag) => tag.includes(`href="${href}"`));
}

function renderNav(active: Parameters<typeof buildNav>[0]["active"]): string {
  const nav = buildNav({
    windowKey: "2026-09",
    role: "technical",
    partners: [partner("scopely", "Scopely"), partner("niantic", "Niantic")],
    alerts: { count: 2 },
    health: { count: 0 },
    active,
  });
  return renderToStaticMarkup(<Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview" }]}><p /></Shell>);
}

describe("shell", () => {
  it("gives each partner a dot tone from its worst status and keeps the window on every link", () => {
    const nav = buildNav({
      windowKey: "2026-09",
      role: "technical",
      partners: [
        partner("scopely", "Scopely", { worst: "breaching", trackingOnly: false }),
        partner("niantic", "Niantic", { worst: "at_risk", trackingOnly: false }),
        partner("kabam", "Kabam", { worst: "meeting", trackingOnly: false }),
        partner("roblox", "Roblox"),
      ],
      alerts: { count: 2 },
      health: { count: 0 },
      active: { kind: "partner", id: "niantic" },
    });
    expect(nav.partners.map((entry) => entry.tone)).toEqual(["breaching", "at_risk", "meeting", "tracking"]);
    expect(nav.partners[0]?.href).toBe("/partners/scopely?window=2026-09");
    expect(withWindow("/alerts", "2026-09")).toBe("/alerts?window=2026-09");

    const html = renderToStaticMarkup(
      <Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview", href: "/?window=2026-09" }, { label: "Niantic" }]}>
        <p>content</p>
      </Shell>,
    );
    expect(sidebarAnchor(html, "/?window=2026-09")).toBeDefined();
    expect(sidebarAnchor(html, "/alerts?window=2026-09")).toBeDefined();
    expect(sidebarAnchor(html, "/health")).toBeDefined();
    expect(sidebarAnchor(html, "/partners/scopely?window=2026-09")).toBeDefined();
    expect(sidebarAnchor(html, "/partners/niantic?window=2026-09")).toBeDefined();
    expect(sidebarAnchor(html, "/partners/niantic?window=2026-09")).toContain('aria-current="page"');
    expect(sidebarAnchor(html, "/partners/scopely?window=2026-09")).not.toContain("aria-current");
    expect(sidebarAnchors(html).filter((tag) => tag.includes("aria-current"))).toHaveLength(1);
    expect(html).toContain(">2<");
    expect(html).toContain("Breaching");
    expect(html).toContain("No rows dropped");
    expect(html).toContain("2026-09-23 15:58:00 UTC");
  });

  it("marks a failed badge with ! and gives failed partners no dot tone", () => {
    const nav = buildNav({
      windowKey: "2026-09",
      role: "technical",
      partners: unavailablePartners(null, "technical"),
      alerts: { status: "error" },
      health: { status: "error" },
      active: { kind: "overview" },
    });
    expect(nav.partners[0]?.tone).toBe("unknown");
    const html = renderToStaticMarkup(<Shell nav={nav} frame={frame} breadcrumb={[{ label: "Overview" }]}><p /></Shell>);
    expect(html.match(/>!</g)?.length).toBeGreaterThanOrEqual(2);
    for (const entry of nav.partners) expect(html).toContain(entry.name);
    for (const label of ["Breaching", "At risk", "Meeting", "Tracking only"]) expect(html).not.toContain(label);
    expect(html).not.toContain("rounded-full");
  });

  it.each([
    [{ kind: "overview" } as const, "/?window=2026-09"],
    [{ kind: "alerts" } as const, "/alerts?window=2026-09"],
    [{ kind: "health" } as const, "/health"],
  ])("marks only the %o entry as the current page", (active, href) => {
    const html = renderNav(active);
    expect(sidebarAnchor(html, href)).toContain('aria-current="page"');
    expect(sidebarAnchors(html).filter((tag) => tag.includes("aria-current"))).toHaveLength(1);
  });

  it("hides alerts and health for the business role", () => {
    const nav = buildNav({ windowKey: "2026-09", role: "business", partners: [partner("scopely", "Scopely")], alerts: null, health: null, active: { kind: "overview" } });
    const html = renderToStaticMarkup(<Shell nav={nav} frame={{ ...frame, chip: { ...frame.chip, href: null } }} breadcrumb={[{ label: "Overview" }]}><p /></Shell>);
    expect(html).not.toContain("/alerts");
    expect(html).not.toContain("/health");
    expect(sidebarAnchor(html, "/?window=2026-09")).toContain('aria-current="page"');
    expect(sidebarAnchor(html, "/partners/scopely?window=2026-09")).toBeDefined();
  });
});
