import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrendSparkline } from "@/app/dashboard/trend-sparkline";
import { buildTrend } from "@/app/dashboard/view";

const history = [
  { month: "2025-10", usedMinutes: null },
  { month: "2025-11", usedMinutes: null },
  { month: "2025-12", usedMinutes: null },
  { month: "2026-01", usedMinutes: 4 },
  { month: "2026-02", usedMinutes: 0 },
  { month: "2026-03", usedMinutes: 9 },
  { month: "2026-04", usedMinutes: 0 },
  { month: "2026-05", usedMinutes: 12 },
  { month: "2026-06", usedMinutes: 30 },
  { month: "2026-07", usedMinutes: 8 },
  { month: "2026-08", usedMinutes: 20 },
];

describe("window trend", () => {
  it("renders eleven prior months plus the current month, with a gap for each month before coverage", () => {
    const html = renderToStaticMarkup(<TrendSparkline trend={buildTrend(history, "2026-09", 76)} status="breached" />);
    expect(html.match(/<rect/g)).toHaveLength(9);
    expect(html).toContain("<title>September 2026: 76.0 min</title>");
    expect(html).toContain("<title>January 2026: 4.0 min</title>");
    expect(html).toContain("October 2025: no data");
    expect(html).toContain(">Oct</span>");
    expect(html).toContain(">Sep</span>");
  });

  it("stretches to the full width and carries no median comparison", () => {
    const html = renderToStaticMarkup(<TrendSparkline trend={buildTrend(history, "2026-09", 76)} status="breached" />);
    expect(html).toContain('width="100%"');
    expect(html).not.toMatch(/[↑↓→]/);
    expect(html).not.toContain("median");
    expect(html).not.toContain("n/a");
  });
});
