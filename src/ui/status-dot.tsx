const styles = {
  breached: { dot: "bg-danger border-danger", text: "Breached", mark: "!", markTone: "text-danger" },
  at_risk: { dot: "bg-warning border-warning", text: "At risk", mark: "!", markTone: "text-warning" },
  meeting: { dot: "bg-transparent border-foreground", text: "Meeting", mark: null, markTone: null },
  tracking: { dot: "bg-transparent border-muted-foreground", text: "Tracking only", mark: null, markTone: null },
} as const;

/** The dot carries a visually hidden label and a visible mark for status. */
export function StatusDot({ tone }: { tone: "breached" | "at_risk" | "meeting" | "tracking" }) {
  const style = styles[tone];
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`inline-block size-2 rounded-full border ${style.dot}`} />
      <span className="sr-only">{style.text}</span>
      {style.mark === null ? null : <span className={`font-mono text-xs font-medium ${style.markTone}`}>{style.mark}</span>}
    </span>
  );
}
