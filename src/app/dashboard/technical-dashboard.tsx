import { Card, Chip } from "@/ui";
import { BUSINESS_VIEWER, HEALTH_UNAVAILABLE, SETTLED_NOTE, phaseLabel } from "./copy";
import { HealthPanel } from "./health-panel";
import type { DashboardModel } from "./model";
import { PartnerTable } from "./partner-table";
import { WindowSelect } from "./window-select";

export function TechnicalDashboard({ model }: { model: DashboardModel }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Engineer view</p>
            <h1 className="text-2xl font-semibold tracking-tight">SLA tracking</h1>
          </div>
          <WindowSelect months={model.months} title={model.windowTitle} phase={model.phase} />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {model.state === "unavailable"
              ? `Load failed at ${model.attemptedAtLabel}`
              : `as of ${model.asOfLabel}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{phaseLabel(model.phase)}</Chip>
            {model.state === "ready" ? <Chip tone={model.chip.tone}>{model.chip.label}</Chip> : null}
            {model.state === "unavailable" ? <Chip tone="danger">Data unavailable</Chip> : null}
          </div>
        </div>
        {model.phase === "settled" ? <p className="text-sm text-muted-foreground">{SETTLED_NOTE}</p> : null}
        {model.state !== "business_viewer" && model.partners.every((partner) => partner.trackingOnly) ? (
          <p className="max-w-3xl text-sm text-pretty text-muted-foreground">
            Every partner is tracking-only. Minutes are recorded downtime for this window. There is no status to
            show.
          </p>
        ) : null}
      </header>
      {model.state === "ready" ? <HealthPanel health={model.health} /> : null}
      {model.state === "unavailable" ? (
        <section aria-labelledby="data-health-heading">
          <Card>
            <div className="flex flex-col gap-4">
              <h2 id="data-health-heading" className="text-lg font-semibold tracking-tight">
                Data health
              </h2>
              <p className="text-sm text-danger" role="alert">
                {HEALTH_UNAVAILABLE}
              </p>
            </div>
          </Card>
        </section>
      ) : null}
      {model.state === "business_viewer" ? (
        <Card>
          <p className="text-sm text-foreground" role="alert">
            {BUSINESS_VIEWER}
          </p>
        </Card>
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="downtime-heading">
          <h2 id="downtime-heading" className="text-lg font-semibold tracking-tight">
            Downtime
          </h2>
          {model.state === "unavailable" ? (
            <p className="text-sm text-danger" role="alert">
              {model.message}
            </p>
          ) : null}
          <PartnerTable partners={model.partners} windowKey={model.windowKey} />
        </section>
      )}
    </div>
  );
}
