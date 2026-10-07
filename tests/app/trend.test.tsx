import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrendSparkline } from "@/app/dashboard/trend-sparkline";
import { buildTrend } from "@/app/dashboard/view";

const history = [
  { month: "2026-03", usedMinutes: null },
  { month: "2026-04", usedMinutes: 0 },
  { month: "2026-05", usedMinutes: 12 },
  { month: "2026-06", usedMinutes: 30 },
  { month: "2026-07", usedMinutes: 8 },
  { month: "2026-08", usedMinutes: 20 },
];

describe("trend column", () => {
  it("renders six prior bars plus the current month and the mark text", () => {
    const html = renderToStaticMarkup(<TrendSparkline trend={buildTrend(history, "2026-09", 76, "above")} status="breaching" />);
    expect(html.match(/<rect/g)).toHaveLength(6);
    expect(html).toContain("above median");
    expect(html).toContain("<title>September 2026: 76.0 min</title>");
  });

  it("writes n/a when there is no comparison, with no leading space or glyph", () => {
    const html = renderToStaticMarkup(<TrendSparkline trend={buildTrend(history, "2026-09", 5, null)} status={null} />);
    expect(html).toContain("n/a");
    expect(html).not.toMatch(/[↑↓→]/);
    expect(html).toContain('text-muted-foreground">n/a</span>');
  });

  it("hides the arrow glyph from assistive technology", () => {
    const html = renderToStaticMarkup(<TrendSparkline trend={buildTrend(history, "2026-09", 76, "above")} status="breaching" />);
    expect(html).toContain('<span aria-hidden="true">↑</span> above median');
  });
});
