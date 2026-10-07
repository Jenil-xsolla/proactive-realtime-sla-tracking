import { BudgetBar, Caret, StatusBadge } from "@/ui";
import { FILED_AGAINST } from "./copy";
import { OutageLines } from "./outage-lines";
import type { ScopeView, ScoredDetails } from "./model";

export const scoredRowClass =
  "grid grid-cols-[3.25rem_minmax(10rem,1.4fr)_7rem_9rem_7rem_7rem_7rem_8rem_12rem_9rem_9rem] items-start";

const badgeVariant = {
  meeting: "neutral",
  at_risk: "warning",
  breaching: "danger",
} as const;

const barTone = {
  meeting: "neutral",
  at_risk: "warning",
  breaching: "danger",
} as const;

export function ScoredScopeRow({
  partnerName,
  row,
}: {
  partnerName: string;
  row: ScopeView & { score: ScoredDetails };
}) {
  const score = row.score;
  if (row.outages.length === 0) {
    return (
      <tr className="border-b border-border last:border-b-0">
        <td className="p-0">
          <ScoredFacts service={row.service} score={score} expandable={false} />
        </td>
      </tr>
    );
  }

  const panelId = `outages-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="p-0">
        <details data-outages="" className="group">
          <summary
            aria-expanded={false}
            aria-controls={panelId}
            aria-label={`Show outages for ${partnerName}, ${row.service}`}
            className="cursor-pointer list-none disclosure"
          >
            <ScoredFacts service={row.service} score={score} expandable />
          </summary>
          <div id={panelId} className="border-t border-border bg-muted p-3">
            <OutageLines
              outages={row.outages}
              serviceCaption={score.showFiledService ? FILED_AGAINST : undefined}
            />
          </div>
        </details>
      </td>
    </tr>
  );
}

function ScoredFacts({
  service,
  score,
  expandable,
}: {
  service: string;
  score: ScoredDetails;
  expandable: boolean;
}) {
  return (
    <div>
      <div className={scoredRowClass}>
        <span className="px-3 py-3">
          {expandable ? (
            <span className="inline-flex items-center justify-center rounded border border-transparent px-3 py-2 text-foreground group-open:[&_svg]:rotate-90">
              <Caret direction="right" />
            </span>
          ) : null}
        </span>
        <span className="px-3 py-3 text-sm text-foreground">{service}</span>
        <Figure value={score.target} clause={score.clauseText} missing={score.clauseMissing} />
        <span className="px-3 py-3 text-right font-mono text-sm tabular-nums text-foreground">{score.allowance}</span>
        <span className="px-3 py-3 text-right font-mono text-sm tabular-nums text-foreground">{score.consumed}</span>
        <span className="px-3 py-3 text-right font-mono text-sm tabular-nums text-foreground">{score.remaining}</span>
        <span className="px-3 py-3">
          <BudgetBar
            usedMinutes={score.usedMinutes}
            allowedMinutes={score.allowedMinutes}
            tone={barTone[score.status]}
          />
        </span>
        <span className="px-3 py-3">
          <StatusBadge variant={badgeVariant[score.status]} label={score.statusLabel} />
        </span>
        <span className="px-3 py-3 text-right font-mono text-sm tabular-nums text-foreground">{score.exhaustion}</span>
        <Figure
          value={score.incurred}
          clause={score.clauseText}
          missing={score.clauseMissing}
          penalty="incurred"
        />
        <Figure
          value={score.projected}
          clause={score.clauseText}
          missing={score.clauseMissing}
          penalty="projected"
        />
      </div>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-sm text-foreground">{score.explanation}</p>
        {score.affected !== null ? <p className="text-sm text-foreground">{score.affected}</p> : null}
        {score.tierDistance !== null ? <p className="text-sm text-foreground">{score.tierDistance}</p> : null}
        {score.windowNote !== null ? <p className="text-sm text-muted-foreground">{score.windowNote}</p> : null}
      </div>
    </div>
  );
}

function Figure({
  value,
  clause,
  missing,
  penalty,
}: {
  value: string;
  clause: string;
  missing: boolean;
  penalty?: "incurred" | "projected";
}) {
  return (
    <span className="px-3 py-3 text-right">
      <span
        className="block font-mono text-sm tabular-nums text-foreground"
        data-penalty={penalty}
      >
        {value}
      </span>
      <span className={`mt-1 block text-xs ${missing ? "text-warning" : "text-muted-foreground"}`}>{clause}</span>
    </span>
  );
}
