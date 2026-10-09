import { Chip, StatusBadge } from "@/ui";
import { badgeVariant } from "./attention-table";
import { TRACKING_ONLY_LABEL, statusLabel } from "./copy";
import type { RailCard } from "./overview";

export function PartnerRail({ cards }: { cards: readonly RailCard[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {cards.map((card) => (
        <li key={card.id} className="rounded border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <a href={card.href} className="text-sm font-medium text-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{card.name}</a>
            {card.unavailable ? null : card.worst === null ? <Chip>{TRACKING_ONLY_LABEL}</Chip> : <StatusBadge variant={badgeVariant[card.worst]} label={statusLabel(card.worst)} />}
          </div>
          <p className={`mt-2 font-mono text-xs ${card.unavailable ? "text-danger" : "text-muted-foreground"}`} role={card.unavailable ? "alert" : undefined}>{card.line}</p>
          {card.termsLink === null ? null : (
            <a href={card.termsLink.href} className="mt-2 inline-block text-xs text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{card.termsLink.label}</a>
          )}
        </li>
      ))}
    </ul>
  );
}
