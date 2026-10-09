import { StatusBadge } from "@/ui";
import { badgeVariant } from "./attention-table";
import { NO_TICKETS, UPTIME_CAPTION, statusLabel } from "./copy";
import type { TermView } from "./view";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function CoverageCards({ terms }: { terms: readonly TermView[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {terms.map((term) => (
        <article key={term.key} className="flex flex-col gap-4 rounded border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-medium text-foreground">{term.title}</h3>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{UPTIME_CAPTION}</p>
            </div>
            <StatusBadge variant={badgeVariant[term.status]} label={statusLabel(term.status)} />
          </div>
          <dl className="flex flex-col">
            <Row label="Target uptime" value={term.target} />
            <Row label={term.actualCaption === null ? "Actual uptime" : `Actual uptime (${term.actualCaption})`} value={term.actual} />
            <Row label="Allowed downtime" value={term.allowed} />
            <Row label="Consumed downtime" value={term.consumed} />
            <Row label="Remaining" value={term.remaining} />
            <Row label="Credit incurred" value={term.credit.incurred} />
            <Row label="Credit projected" value={term.credit.projected} />
            {term.nextTier === null ? null : <Row label="Next tier" value={term.nextTier} />}
            {term.windowNote === null ? null : <Row label="Window start" value={term.windowNote} />}
          </dl>
          {term.clause === null ? null : (
            <p className={`text-xs ${term.clause.missing ? "text-warning" : "text-muted-foreground"}`}>{term.clause.text}</p>
          )}
          <p className="text-sm text-foreground">{term.sentence}</p>
          {term.tickets === null ? null : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tickets</p>
              {term.tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{NO_TICKETS}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {term.tickets.map((ticket) => (
                    <li key={ticket.key}>
                      {ticket.href === null ? (
                        <span className="font-mono text-sm text-foreground">{ticket.key}</span>
                      ) : (
                        <a href={ticket.href} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{ticket.key}</a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
