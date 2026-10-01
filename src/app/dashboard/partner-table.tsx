import { Button, Table, TableBody, TableHead, Tooltip } from "@/ui";
import { ADD_CONTRACT_TERMS, VIEW_TERMS } from "./copy";
import { OUTAGE_DISCLOSURE_SCRIPT } from "./outage-disclosure";
import type { PartnerView } from "./model";
import { ScopeRow, downtimeRowClass } from "./scope-row";

function ContractTermsLink({ partner }: { partner: PartnerView }) {
  if (partner.contractTerms === "unknown") {
    return null;
  }
  const label = partner.contractTerms === "view" ? VIEW_TERMS : ADD_CONTRACT_TERMS;
  return (
    <a
      href={`/partners/${partner.id}/terms`}
      className="text-sm font-medium text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
    </a>
  );
}

export function PartnerTable({ partners }: { partners: readonly PartnerView[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {partners.map((partner) => (
        <section key={partner.id} className="min-w-0 rounded border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-3 py-3">
            <h3 className="font-medium text-foreground">{partner.name}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <ContractTermsLink partner={partner} />
              <Tooltip label={partner.backtestTooltip}>
                <Button disabled aria-label={`Backtest ${partner.name}`}>
                  Backtest
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <Table framed={false} caption={`Downtime for ${partner.name}`}>
              <TableHead>
                <tr className="border-b border-border">
                  <th colSpan={5} className="p-0 text-left font-normal">
                    <div className={downtimeRowClass}>
                      <span className="sr-only px-3 py-3">Outages</span>
                      <span className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Service
                      </span>
                      <span className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Minutes this window
                      </span>
                      <span className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Incidents
                      </span>
                      <span className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Compared with recent months
                      </span>
                    </div>
                  </th>
                </tr>
              </TableHead>
              <TableBody>
                {partner.rows.map((row) => (
                  <ScopeRow key={row.key} partnerName={partner.name} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
      <script dangerouslySetInnerHTML={{ __html: OUTAGE_DISCLOSURE_SCRIPT }} />
    </div>
  );
}
