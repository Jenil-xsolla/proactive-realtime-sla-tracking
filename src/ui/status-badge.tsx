/**
 * Status never rides on colour alone: the label is required and visible.
 * Success, warning, and danger are the meeting, at-risk, and breaching tokens.
 */
const variants = {
  neutral: "border-border bg-secondary text-foreground",
  success: "border-success bg-secondary text-success",
  warning: "border-warning bg-secondary text-warning",
  danger: "border-danger bg-secondary text-danger",
} as const;

export type StatusBadgeVariant = keyof typeof variants;

export function StatusBadge({
  variant,
  label,
}: {
  variant: StatusBadgeVariant;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-1 text-xs font-medium ${variants[variant]}`}
    >
      {label}
    </span>
  );
}
