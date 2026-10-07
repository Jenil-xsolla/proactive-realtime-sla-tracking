import { BudgetBar, Caret, StatusBadge, Table, TableBody, TableHead } from "@/ui";
import { badgeVariant } from "./attention-table";
import { FILED_AGAINST, statusLabel } from "./copy";
import { OutageLines } from "./outage-lines";
import { TrendSparkline } from "./trend-sparkline";
import type { TermView } from "./view";

const COLUMNS = 7;
const GRID = "grid-cols-[minmax(8rem,1.4fr)_7rem_9.5rem_9rem_minmax(8rem,11rem)_7.5rem_10rem]";

function Facts({ term }: { term: TermView }) {
  const actualTone = term.status === "meeting" ? "text-foreground" : term.status === "at_risk" ? "text-warning" : "text-danger";
  return (
    <div className={`grid ${GRID} items-center gap-x-3 px-3 py-3`}>
      <span>
        <span className="block text-sm font-medium text-foreground">{term.title}</span>
        <span className="block font-mono text-xs text-muted-foreground">{term.downLine}</span>
      </span>
      <span><StatusBadge variant={badgeVariant[term.status]} label={statusLabel(term.status)} /></span>
      <span className="text-right font-mono text-sm tabular-nums">
        {term.target} / <span className={actualTone}>{term.actual}</span>
        {term.actualCaption === null ? null : <span className="block text-xs text-muted-foreground">{term.actualCaption}</span>}
      </span>
      <span>
        <BudgetBar usedMinutes={term.usedMinutes} allowedMinutes={term.allowedMinutes} tone={badgeVariant[term.status]} />
        <span className="mt-1 flex justify-between font-mono text-xs text-muted-foreground"><span>{term.consumedPercent}</span><span>max 100%</span></span>
      </span>
      <span><TrendSparkline trend={term.trend} status={term.status} /></span>
      <span className="text-right font-mono text-sm tabular-nums text-foreground">{term.exhaustion}</span>
      <span className="text-right font-mono text-sm tabular-nums text-foreground">{term.credit.text}</span>
    </div>
  );
}

export function TermTable({ partnerName, terms }: { partnerName: string; terms: readonly TermView[] }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded border border-border">
      <Table framed={false} caption={`SLA term evaluations for ${partnerName}`}>
        <TableHead>
          <tr className="border-b border-border">
            <th colSpan={COLUMNS} className="p-0 text-left font-normal">
              <div className={`grid ${GRID} gap-x-3 px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground`}>
                <span>Service</span><span>Status</span><span className="text-right">Target / Actual</span><span>Error budget</span><span>Window trend</span><span className="text-right">Projected</span><span className="text-right">Credit</span>
              </div>
            </th>
          </tr>
        </TableHead>
        <TableBody>
          {terms.map((term) => {
            const panelId = `outages-${term.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
            return (
              <tr key={term.key} className="border-b border-border last:border-b-0">
                <td colSpan={COLUMNS} className="p-0">
                  {term.outages !== null && term.outages.length > 0 ? (
                    <details data-outages="" className="group">
                      <summary aria-expanded={false} aria-controls={panelId} aria-label={`Show outages for ${partnerName}, ${term.title}`} className="disclosure flex cursor-pointer list-none items-center">
                        <span className="px-3 text-foreground group-open:[&_svg]:rotate-90"><Caret direction="right" /></span>
                        <div className="min-w-0 flex-1"><Facts term={term} /></div>
                      </summary>
                      <div id={panelId} className="border-t border-border bg-muted p-3">
                        <OutageLines outages={term.outages} serviceCaption={FILED_AGAINST} />
                      </div>
                    </details>
                  ) : (
                    <div className="flex items-center"><span className="w-10" /><div className="min-w-0 flex-1"><Facts term={term} /></div></div>
                  )}
                </td>
              </tr>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
