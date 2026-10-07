import { Sparkline } from "@/ui";
import type { Status, TrendView } from "./view";

const tones = { meeting: "neutral", at_risk: "warning", breaching: "danger" } as const;
const marks = { up: "↑", down: "↓", flat: "→", none: "" } as const;

export function TrendSparkline({ trend, status }: { trend: TrendView; status: Status | null }) {
  const markTone = trend.mark === "up" ? "text-danger" : "text-muted-foreground";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Sparkline
        label={trend.summary}
        currentTone={status === null ? "neutral" : tones[status]}
        bars={trend.bars.map((bar) => ({
          value: bar.minutes,
          title: `${bar.label}: ${bar.minutes === null ? "no data" : `${bar.minutes.toFixed(1)} min`}`,
          current: bar.current,
        }))}
      />
      <span className={`font-mono text-xs leading-tight ${markTone}`}>
        {marks[trend.mark]} {trend.text}
      </span>
    </span>
  );
}
