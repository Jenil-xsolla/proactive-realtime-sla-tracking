import { unstable_noStore as noStore } from "next/cache";
import { alertsBadge, healthBadge, loadWorkspace } from "./dashboard/load";
import { buildNav } from "./dashboard/nav";
import { buildOverview } from "./dashboard/overview";
import { OverviewPage } from "./dashboard/overview-page";
import { Shell } from "./shell/shell";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ window?: string | string[] }> }) {
  noStore();
  const params = await searchParams;
  const workspace = await loadWorkspace({ window: single(params.window) });
  const nav = buildNav({
    windowKey: workspace.frame.windowKey,
    role: workspace.role,
    partners: workspace.partners,
    alerts: alertsBadge(workspace.alerts, workspace.frame.windowKey),
    health: healthBadge(workspace.health),
    active: { kind: "overview" },
  });
  const view = buildOverview({
    partners: workspace.partners,
    phase: workspace.frame.phase,
    windowKey: workspace.frame.windowKey,
    failure: workspace.failure,
    role: workspace.role,
  });
  return (
    <Shell nav={nav} frame={{ ...workspace.frame, chip: workspace.chip }} breadcrumb={[{ label: "Overview" }]}>
      <OverviewPage view={view} />
    </Shell>
  );
}
