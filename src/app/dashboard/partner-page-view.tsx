import { Button, Chip, StatusBadge, Tile, Tooltip } from "@/ui";
import { badgeVariant } from "./attention-table";
import { BacktestPanel } from "./backtest-panel";
import { CoverageCards } from "./coverage-cards";
import { NO_DOWNTIME, ROW_UNAVAILABLE, TRACKING_ONLY_LABEL, UNAVAILABLE, statusLabel } from "./copy";
import type { BacktestPanel as BacktestPanelModel } from "./model";
import { OUTAGE_DISCLOSURE_SCRIPT } from "./outage-disclosure";
import type { PartnerPageView as Model } from "./partner-page";
import { TermTable } from "./term-table";
import { TrackingTable } from "./tracking-table";
import { buildTrend } from "./view";

export function PartnerPageView({ view, backtest }: { view: Model; backtest: BacktestPanelModel | null }) {
  const unavailableRow = {
    key: `${view.id}:unavailable`, service: UNAVAILABLE, minutes: UNAVAILABLE, incidents: UNAVAILABLE, usedMinutes: 0, outageCount: 0,
    comparison: ROW_UNAVAILABLE, trend: buildTrend([], view.windowKey, 0, null), outages: null, reconciliation: "",
  };
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{view.name}</h1>
            {view.unavailable ? null : view.worst === null ? <Chip>{TRACKING_ONLY_LABEL}</Chip> : <StatusBadge variant={badgeVariant[view.worst]} label={statusLabel(view.worst)} />}
          </div>
          <p className="flex flex-wrap items-center gap-2 font-mono text-sm text-muted-foreground">
            {view.meta.map((item, index) => (
              <span key={item} className="flex items-center gap-2">{index > 0 ? <span>·</span> : null}<span>{item}</span></span>
            ))}
            {view.termsLink === null ? null : (
              <span className="flex items-center gap-2"><span>·</span><a href={view.termsLink.href} className="text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{view.termsLink.label}</a></span>
            )}
          </p>
          {view.settledNote === null ? null : <p className="text-sm text-muted-foreground">{view.settledNote}</p>}
          {view.failure === null ? null : <p role="alert" className="text-sm text-danger">{view.failure}</p>}
        </div>
        {view.backtest === null ? null : view.backtest.enabled ? (
          <form method="get" action={`/partners/${view.id}`} className="inline-flex">
            <input type="hidden" name="window" value={view.backtest.windowKey} />
            <input type="hidden" name="backtest" value="1" />
            <Button type="submit" aria-label={`Backtest ${view.name}`}>Backtest</Button>
          </form>
        ) : (
          <Tooltip label={view.backtest.tooltip}><Button disabled aria-label={`Backtest ${view.name}`}>Backtest</Button></Tooltip>
        )}
      </header>
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {view.tiles.map((tile) => <Tile key={tile.label} {...tile} />)}
      </section>
      {view.terms.length > 0 ? (
        <section aria-labelledby="terms-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex items-baseline justify-between"><h2 id="terms-heading" className="text-lg font-semibold tracking-tight">SLA term evaluations</h2><span className="font-mono text-xs text-muted-foreground">monthly window</span></div>
          <TermTable partnerName={view.name} terms={view.terms} />
        </section>
      ) : null}
      {backtest === null ? null : <BacktestPanel partnerName={view.name} panel={backtest} />}
      {view.terms.length > 0 ? (
        <section aria-labelledby="coverage-heading" className="flex flex-col gap-4">
          <h2 id="coverage-heading" className="text-lg font-semibold tracking-tight">Coverage terms</h2>
          <CoverageCards terms={view.terms} />
        </section>
      ) : null}
      {view.unavailable || view.tracking.length > 0 || view.terms.length === 0 ? (
        <section aria-labelledby="tracking-heading" className="flex min-w-0 flex-col gap-4">
          <h2 id="tracking-heading" className="text-lg font-semibold tracking-tight">{view.trackingHeading}</h2>
          {view.trackingNote === null ? null : <p className="text-sm text-muted-foreground">{view.trackingNote}</p>}
          {!view.unavailable && view.tracking.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_DOWNTIME}</p>
          ) : (
            <TrackingTable partnerName={view.name} rows={view.unavailable ? [unavailableRow] : view.tracking} unavailable={view.unavailable} />
          )}
        </section>
      ) : null}
      <script dangerouslySetInnerHTML={{ __html: OUTAGE_DISCLOSURE_SCRIPT }} />
    </>
  );
}
