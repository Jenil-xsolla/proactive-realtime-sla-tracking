import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline, StatusBadge, StatusDot, Tile } from "@/ui";

describe("ui primitives", () => {
  it("renders a tile with label, value, and detail in token classes", () => {
    const html = renderToStaticMarkup(<Tile label="Breaching" value="3" detail="of 3 terms" tone="danger" emphasis />);
    expect(html).toContain("Breaching");
    expect(html).toContain(">3<");
    expect(html).toContain("of 3 terms");
    expect(html).toContain("text-danger");
    expect(html).toContain("border-danger");
    expect(html).toContain("bg-danger/10");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("renders a tile without emphasis using token border and background", () => {
    const html = renderToStaticMarkup(<Tile label="Neutral" value="5" detail="items" />);
    expect(html).toContain("border-border");
    expect(html).toContain("bg-card");
    expect(html).not.toContain("border-danger");
  });

  it("draws one rect per known month, none for a gap, and a title per bar", () => {
    const html = renderToStaticMarkup(
      <Sparkline
        label="Six months of downtime"
        currentTone="danger"
        bars={[
          { value: null, title: "March 2026: no data", current: false },
          { value: 0, title: "April 2026: 0.0 min", current: false },
          { value: 30, title: "May 2026: 30.0 min", current: false },
          { value: 76, title: "September 2026: 76.0 min", current: true },
        ]}
      />,
    );
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html).toContain("<title>May 2026: 30.0 min</title>");
    expect(html).toContain("fill-danger");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Six months of downtime"');
  });

  it("marks a breaching dot with visible mark and sr-only label", () => {
    const html = renderToStaticMarkup(<StatusDot tone="breaching" />);
    expect(html).toMatch(/class="sr-only">Breaching</);
    expect(html).toMatch(/text-danger">!</);
  });

  it("marks an at-risk dot with warning mark and sr-only label", () => {
    const html = renderToStaticMarkup(<StatusDot tone="at_risk" />);
    expect(html).toMatch(/class="sr-only">At risk</);
    expect(html).toMatch(/text-warning">!</);
  });

  it("renders a meeting dot hollow with no visible mark", () => {
    const html = renderToStaticMarkup(<StatusDot tone="meeting" />);
    expect(html).toMatch(/class="sr-only">Meeting</);
    expect(html).not.toContain("text-warning");
    expect(html).not.toContain("text-danger");
    expect(html).not.toMatch(/>!</);
  });

  it("renders a tracking dot hollow with no visible mark", () => {
    const html = renderToStaticMarkup(<StatusDot tone="tracking" />);
    expect(html).toMatch(/class="sr-only">Tracking only</);
    expect(html).not.toContain("text-warning");
    expect(html).not.toContain("text-danger");
    expect(html).not.toMatch(/>!</);
  });

  it("prints a text label on warning and danger badges", () => {
    expect(renderToStaticMarkup(<StatusBadge variant="warning" label="At risk" />)).toContain("At risk");
    expect(renderToStaticMarkup(<StatusBadge variant="danger" label="Breaching" />)).toContain("Breaching");
  });
});
