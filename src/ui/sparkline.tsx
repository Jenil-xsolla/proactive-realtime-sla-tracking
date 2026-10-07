const fills = {
  neutral: "fill-foreground",
  warning: "fill-warning",
  danger: "fill-danger",
} as const;

const WIDTH = 84;
const HEIGHT = 24;
const GAP = 2;

/**
 * Thin bars, one per month, 2px apart. A null value draws nothing: a gap is
 * unknown, not zero. A zero draws a 1px baseline tick so it reads as "clean".
 */
export function Sparkline({
  bars,
  currentTone,
  label,
}: {
  bars: readonly { value: number | null; title: string; current: boolean }[];
  currentTone: keyof typeof fills;
  label: string;
}) {
  const count = Math.max(bars.length, 1);
  const barWidth = (WIDTH - GAP * (count - 1)) / count;
  const max = Math.max(1, ...bars.map((bar) => bar.value ?? 0));
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-label={label} className="shrink-0">
      {bars.map((bar, index) => {
        if (bar.value === null) {
          return null;
        }
        const height = bar.value === 0 ? 1 : Math.max(1, (bar.value / max) * HEIGHT);
        return (
          <rect
            key={index}
            x={index * (barWidth + GAP)}
            y={HEIGHT - height}
            width={barWidth}
            height={height}
            rx={1}
            className={bar.current ? fills[currentTone] : "fill-muted-foreground"}
          >
            <title>{bar.title}</title>
          </rect>
        );
      })}
    </svg>
  );
}
