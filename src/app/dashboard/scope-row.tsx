import { Caret } from "@/ui";
import { OutageLines } from "./outage-lines";
import type { ScopeView } from "./model";
import { ScoredScopeRow } from "./scored-row";

export const downtimeRowClass =
  "grid grid-cols-[3.25rem_minmax(0,1.4fr)_8.5rem_5.5rem_minmax(0,2fr)] items-start";

export function ScopeRow({ partnerName, row }: { partnerName: string; row: ScopeView }) {
  if (row.score !== null) {
    return <ScoredScopeRow partnerName={partnerName} row={{ ...row, score: row.score }} />;
  }
  const emphasis = row.tone === "unavailable" ? "text-danger" : "text-foreground";
  if (row.outages.length === 0) {
    return (
      <tr className="border-b border-border last:border-b-0">
        <td colSpan={5} className="p-0">
          <div className={downtimeRowClass}>
            <span />
            <span className={`px-3 py-3 text-sm ${emphasis}`}>{row.service}</span>
            <span className={`px-3 py-3 text-right font-mono text-sm tabular-nums ${emphasis}`}>
              {row.minutes}
            </span>
            <span className={`px-3 py-3 text-right font-mono text-sm tabular-nums ${emphasis}`}>
              {row.incidents}
            </span>
            <span className={`px-3 py-3 text-sm ${emphasis}`}>{row.comparison}</span>
          </div>
        </td>
      </tr>
    );
  }

  const panelId = `outages-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <tr className="border-b border-border last:border-b-0">
      <td colSpan={5} className="p-0">
        <details data-outages="" className="group">
          <summary
            aria-expanded={false}
            aria-controls={panelId}
            aria-label={`Show outages for ${partnerName}, ${row.service}`}
            className={`${downtimeRowClass} cursor-pointer list-none disclosure`}
          >
            <span className="px-3 py-3">
              <span className="inline-flex items-center justify-center rounded border border-transparent px-3 py-2 text-foreground group-open:[&_svg]:rotate-90">
                <Caret direction="right" />
              </span>
            </span>
            <span className={`px-3 py-3 text-sm ${emphasis}`}>{row.service}</span>
            <span className={`px-3 py-3 text-right font-mono text-sm tabular-nums ${emphasis}`}>
              {row.minutes}
            </span>
            <span className={`px-3 py-3 text-right font-mono text-sm tabular-nums ${emphasis}`}>
              {row.incidents}
            </span>
            <span className={`px-3 py-3 text-sm ${emphasis}`}>{row.comparison}</span>
          </summary>
          <div id={panelId} className="border-t border-border bg-muted p-3">
            <OutageLines outages={row.outages} />
          </div>
        </details>
      </td>
    </tr>
  );
}
