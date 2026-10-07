const fills = {
  neutral: "bg-foreground",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

/**
 * Consumed share of the allowance. The status badge carries the words;
 * the fill only reinforces them. Overrun fills the track and the numbers
 * beside it keep the true minutes.
 */
export function BudgetBar({
  usedMinutes,
  allowedMinutes,
  tone,
}: {
  usedMinutes: number;
  allowedMinutes: number;
  tone: keyof typeof fills;
}) {
  const max = allowedMinutes > 0 ? allowedMinutes : Math.max(usedMinutes, 0);
  const fraction = max > 0 ? Math.min(1, Math.max(0, usedMinutes) / max) : 0;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-muted"
      role="meter"
      aria-label="Consumed budget"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number.isFinite(usedMinutes) ? usedMinutes : 0}
    >
      <div className={`h-full ${fills[tone]}`} style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}
