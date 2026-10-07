import { Sparkline } from "@/ui";
import type { Status, TrendView } from "./view";

const tones = { meeting: "neutral", at_risk: "warning", breaching: "danger" } as const;
const marks = { up: "↑", down: "↓", flat: "→", none: "" } as const;

export function TrendSparkline({ trend, status }: { trend: TrendView; status: Status | null }) {
  const markTone = trend.mark === "up" ? "text-danger" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-3">
      <Sparkline
        label={trend.summary}
        currentTone={status === null ? "neutral" : tones[status]}
        bars={trend.bars.map((bar) => ({
          value: bar.minutes,
          title: `${bar.label}: ${bar.minutes === null ? "no data" : `${bar.minutes.toFixed(1)} min`}`,
          current: bar.current,
        }))}
      />
      <span className={`whitespace-nowrap font-mono text-xs ${markTone}`}>
        {marks[trend.mark]} {trend.text}
      </span>
    </span>
  );
}
