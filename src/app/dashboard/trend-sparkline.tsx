import { Sparkline } from "@/ui";
import type { Status, TrendView } from "./view";

const tones = { meeting: "neutral", at_risk: "warning", breached: "danger" } as const;

export function TrendSparkline({ trend, status }: { trend: TrendView; status: Status | null }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <Sparkline
        label={trend.summary}
        currentTone={status === null ? "neutral" : tones[status]}
        bars={trend.bars.map((bar) => ({
          value: bar.minutes,
          title: `${bar.label}: ${bar.minutes === null ? "no data" : `${bar.minutes.toFixed(1)} min`}`,
          current: bar.current,
        }))}
      />
      <div aria-hidden="true" className="grid font-mono text-xs text-muted-foreground" style={{ gridTemplateColumns: `repeat(${trend.bars.length}, minmax(0, 1fr))` }}>
        {trend.bars.map((bar) => (
          <span key={bar.month} className={`text-center ${bar.current ? "text-foreground" : ""}`}>{bar.label.slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
}

export function WindowTrend({ trend, status }: { trend: TrendView; status: Status | null }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Window trend</span>
      <TrendSparkline trend={trend} status={status} />
    </div>
  );
}
