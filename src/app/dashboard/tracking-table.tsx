import { Caret, Table, TableBody, TableHead } from "@/ui";
import { OutageLines } from "./outage-lines";
import { WindowTrend } from "./trend-sparkline";
import type { TrackingView } from "./view";

const GRID = "grid grid-cols-[minmax(10rem,1.4fr)_8rem_6rem_minmax(0,2fr)] items-center gap-x-3 px-3 py-3";

function Facts({ row, unavailable }: { row: TrackingView; unavailable: boolean }) {
  const tone = unavailable ? "text-danger" : "text-foreground";
  return (
    <div className={GRID}>
      <span className={`text-sm ${tone}`}>{row.service}</span>
      <span className={`text-right font-mono text-sm tabular-nums ${tone}`}>{row.minutes}</span>
      <span className={`text-right font-mono text-sm tabular-nums ${tone}`}>{row.incidents}</span>
      <span className={`text-sm ${tone}`}>{row.comparison}</span>
    </div>
  );
}

export function TrackingTable({ partnerName, rows, unavailable = false }: { partnerName: string; rows: readonly TrackingView[]; unavailable?: boolean }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded border border-border">
      <Table framed={false} caption={`Recorded downtime for ${partnerName}`}>
        <TableHead>
          <tr className="border-b border-border">
            <th colSpan={4} className="p-0 text-left font-normal">
              <div className={`${GRID} text-xs font-medium uppercase tracking-wide text-muted-foreground`}>
                <span>Service</span><span className="text-right">Minutes this window</span><span className="text-right">Incidents</span><span>Compared with recent months</span>
              </div>
            </th>
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const panelId = `outages-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
            const outages = row.outages !== null && row.outages.length > 0 ? row.outages : null;
            return (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <td colSpan={4} className="p-0">
                  {unavailable ? (
                    <div className="flex items-center"><span className="w-10" /><div className="min-w-0 flex-1"><Facts row={row} unavailable={unavailable} /></div></div>
                  ) : (
                    <details data-outages={outages === null ? undefined : ""} data-disclosure="" className="group">
                      <summary aria-expanded={false} aria-controls={panelId} aria-label={`Show ${outages === null ? "trend" : "outages"} for ${partnerName}, ${row.service}`} className="disclosure flex cursor-pointer list-none items-center">
                        <span className="px-3 text-foreground group-open:[&_svg]:rotate-90"><Caret direction="right" /></span>
                        <div className="min-w-0 flex-1"><Facts row={row} unavailable={unavailable} /></div>
                      </summary>
                      <div id={panelId} className="flex flex-col gap-3 border-t border-border bg-muted p-3">
                        <WindowTrend trend={row.trend} status={null} />
                        {outages === null ? null : <OutageLines outages={outages} />}
                      </div>
                    </details>
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
