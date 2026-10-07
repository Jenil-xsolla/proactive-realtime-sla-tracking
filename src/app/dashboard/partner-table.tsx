import { Button, Table, TableBody, TableHead, Tooltip } from "@/ui";
import { BacktestPanel } from "./backtest-panel";
import { ADD_CONTRACT_TERMS, SLA_SECTION, TRACKING_ONLY_SECTION, VIEW_TERMS } from "./copy";
import { OUTAGE_DISCLOSURE_SCRIPT } from "./outage-disclosure";
import type { PartnerView, ScopeView } from "./model";
import { scoredRowClass } from "./scored-row";
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

export function PartnerTable({
  partners,
  windowKey = "",
}: {
  partners: readonly PartnerView[];
  windowKey?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {partners.map((partner) => (
        <section key={partner.id} className="min-w-0 rounded border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-3 py-3">
            <h3 className="font-medium text-foreground">{partner.name}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <ContractTermsLink partner={partner} />
              {partner.backtestEnabled ? (
                <form method="get" action="/" className="inline-flex">
                  <input type="hidden" name="window" value={windowKey} />
                  <input type="hidden" name="backtest" value={partner.id} />
                  <Button type="submit" aria-label={`Backtest ${partner.name}`}>
                    Backtest
                  </Button>
                </form>
              ) : (
                <Tooltip label={partner.backtestTooltip}>
                  <Button disabled aria-label={`Backtest ${partner.name}`}>
                    Backtest
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
          <PartnerSections partner={partner} />
          {partner.backtestPanel !== null ? (
            <BacktestPanel partnerName={partner.name} panel={partner.backtestPanel} />
          ) : null}
        </section>
      ))}
      <script dangerouslySetInnerHTML={{ __html: OUTAGE_DISCLOSURE_SCRIPT }} />
    </div>
  );
}

function PartnerSections({ partner }: { partner: PartnerView }) {
  const sla = partner.rows.filter((row) => row.score !== null);
  const tracking = partner.rows.filter((row) => row.score === null);
  if (sla.length === 0 || tracking.length === 0) {
    return <ScopeTable partnerName={partner.name} rows={partner.rows} scored={!partner.trackingOnly} />;
  }
  return (
    <>
      <h4 className="px-3 pt-3 text-sm font-medium text-foreground">{SLA_SECTION}</h4>
      <ScopeTable partnerName={partner.name} rows={sla} scored />
      <h4 className="border-t border-border px-3 pt-3 text-sm font-medium text-foreground">
        {TRACKING_ONLY_SECTION}
      </h4>
      <ScopeTable partnerName={partner.name} rows={tracking} scored={false} />
    </>
  );
}

function ScopeTable({
  partnerName,
  rows,
  scored,
}: {
  partnerName: string;
  rows: readonly ScopeView[];
  scored: boolean;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table framed={false} caption={`Downtime for ${partnerName}`}>
        <TableHead>
          <tr className="border-b border-border">
            <th colSpan={scored ? 1 : 5} className="p-0 text-left font-normal">
              {scored ? <ScoredHead /> : <TrackingHead />}
            </th>
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <ScopeRow key={row.key} partnerName={partnerName} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TrackingHead() {
  return (
    <div className={downtimeRowClass}>
      <span className="sr-only px-3 py-3">Outages</span>
      <span className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Service</span>
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
  );
}

function ScoredHead() {
  return (
    <div className={scoredRowClass}>
      <span className="sr-only px-3 py-3">Outages</span>
      <Head>Scope</Head>
      <Head numeric>Target</Head>
      <Head numeric>Allowance</Head>
      <Head numeric>Consumed</Head>
      <Head numeric>Remaining</Head>
      <Head>Budget</Head>
      <Head>Status</Head>
      <Head numeric>Projected exhaustion</Head>
      <Head numeric>Incurred</Head>
      <Head numeric>Projected</Head>
    </div>
  );
}

function Head({ children, numeric = false }: { children: string; numeric?: boolean }) {
  return (
    <span
      className={`px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground ${numeric ? "text-right" : "text-left"}`}
    >
      {children}
    </span>
  );
}
