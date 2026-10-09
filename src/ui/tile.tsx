const values = {
  neutral: "text-foreground",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
} as const;

const labelTones = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

/**
 * One headline figure. `emphasis` tints the card itself (used for a breaching
 * count). The value is mono so columns of tiles line up.
 */
export function Tile({
  label,
  value,
  detail = null,
  tone = "neutral",
  labelTone,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: keyof typeof values;
  labelTone?: keyof typeof labelTones;
  emphasis?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded border p-5 ${emphasis ? "border-danger bg-danger/10" : "border-border bg-card"}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${labelTone === undefined ? "text-muted-foreground" : labelTones[labelTone]}`}>{label}</p>
      <p className={`font-mono text-3xl tabular-nums ${values[tone]}`}>{value}</p>
      {detail === null ? null : <p className="font-mono text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}
