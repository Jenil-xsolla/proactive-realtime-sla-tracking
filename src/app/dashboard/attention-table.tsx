import { BudgetBar, StatusBadge, Table, TableBody, TableHead, TableHeaderCell } from "@/ui";
import { NO_ATTENTION, statusLabel } from "./copy";
import type { AttentionRow } from "./overview";

export const badgeVariant = { meeting: "neutral", at_risk: "warning", breaching: "danger" } as const;

export function AttentionTable({ rows, failure }: { rows: readonly AttentionRow[]; failure: string | null }) {
  if (failure !== null) {
    return <p role="alert" className="text-sm text-danger">{failure}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{NO_ATTENTION}</p>;
  }
  return (
    <Table caption="Terms at risk or breaching">
      <TableHead>
        <tr className="border-b border-border">
          <TableHeaderCell>Partner · scope</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell numeric>Target / Actual</TableHeaderCell>
          <TableHeaderCell>Error budget</TableHeaderCell>
          <TableHeaderCell numeric>Credit</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <tr key={row.term.key} className="border-b border-border last:border-b-0">
            <td className="px-3 py-3 align-top">
              <a href={row.href} className="text-sm font-medium text-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{row.partnerName}</a>
              <p className="text-xs text-muted-foreground">{row.term.title}</p>
            </td>
            <td className="px-3 py-3 align-top"><StatusBadge variant={badgeVariant[row.term.status]} label={statusLabel(row.term.status)} /></td>
            <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums">
              {row.term.target} / <span className={row.term.status === "breaching" ? "text-danger" : "text-warning"}>{row.term.actual}</span>
              {row.term.actualCaption === null ? null : <span className="block text-xs text-muted-foreground">{row.term.actualCaption}</span>}
            </td>
            <td className="px-3 py-3 align-top">
              <BudgetBar usedMinutes={row.term.usedMinutes} allowedMinutes={row.term.allowedMinutes} tone={badgeVariant[row.term.status]} />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">{row.term.consumedPercent}</span>
            </td>
            <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums">{row.term.credit.text}</td>
          </tr>
        ))}
      </TableBody>
    </Table>
  );
}
