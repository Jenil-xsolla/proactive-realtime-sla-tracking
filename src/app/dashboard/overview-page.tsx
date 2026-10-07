import { Tile } from "@/ui";
import { AttentionTable } from "./attention-table";
import type { OverviewView } from "./overview";
import { PartnerRail } from "./partner-rail";

export function OverviewPage({ view }: { view: OverviewView }) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        {view.summary === "" ? null : <p className="text-sm text-muted-foreground">{view.summary}</p>}
        {view.settledNote === null ? null : <p className="text-sm text-muted-foreground">{view.settledNote}</p>}
        {view.failure === null ? null : <p role="alert" className="text-sm text-danger">{view.failure}</p>}
      </header>
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {view.tiles.map((tile) => (
          <Tile key={tile.label} label={tile.label} value={tile.value} detail={tile.detail} tone={tile.tone} emphasis={tile.emphasis} />
        ))}
      </section>
      <div className="grid gap-10 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section aria-labelledby="attention-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="attention-heading" className="text-lg font-semibold tracking-tight">Needs attention</h2>
            {view.failure === null ? <span className="font-mono text-xs text-muted-foreground">{view.attention.length} flagged</span> : null}
          </div>
          <AttentionTable rows={view.attention} failure={view.failure} />
        </section>
        <section aria-labelledby="rail-heading" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="rail-heading" className="text-lg font-semibold tracking-tight">Partner status</h2>
            <span className="font-mono text-xs text-muted-foreground">worst first</span>
          </div>
          <PartnerRail cards={view.rail} />
        </section>
      </div>
    </>
  );
}
