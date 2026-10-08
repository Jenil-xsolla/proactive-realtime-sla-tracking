const fills = {
  neutral: "fill-foreground",
  warning: "fill-warning",
  danger: "fill-danger",
} as const;

const SLOT = 10;
const GAP = 2;
const HEIGHT = 48;

/**
 * Bars, one per month in equal slots, stretched to the container's width. A
 * null value draws nothing: a gap is unknown, not zero. A zero draws a 1px
 * baseline tick so it reads as "clean".
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
  const width = Math.max(bars.length, 1) * SLOT;
  const max = Math.max(1, ...bars.map((bar) => bar.value ?? 0));
  return (
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none" role="img" aria-label={label} className="block">
      {bars.map((bar, index) => {
        if (bar.value === null) {
          return null;
        }
        const height = bar.value === 0 ? 1 : Math.max(1, (bar.value / max) * HEIGHT);
        return (
          <rect
            key={index}
            x={index * SLOT + GAP / 2}
            y={HEIGHT - height}
            width={SLOT - GAP}
            height={height}
            className={bar.current ? fills[currentTone] : "fill-muted-foreground"}
          >
            <title>{bar.title}</title>
          </rect>
        );
      })}
    </svg>
  );
}
