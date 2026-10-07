import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { AlertsPage } from "@/app/dashboard/alerts-page";
import { buildAlertsView } from "@/app/dashboard/alerts-view";
import { alertsBadge, healthBadge, loadWorkspace } from "@/app/dashboard/load";
import { buildNav } from "@/app/dashboard/nav";
import { Shell } from "@/app/shell/shell";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AlertsRoute({ searchParams }: { searchParams: Promise<{ window?: string | string[] }> }) {
  noStore();
  const params = await searchParams;
  const requested = Array.isArray(params.window) ? params.window[0] : params.window;
  const workspace = await loadWorkspace({ window: requested === "all" ? undefined : requested });
  if (workspace.role === "business") {
    notFound();
  }
  const filterKey = requested === "all" ? "all" : workspace.frame.windowKey;
  const nav = buildNav({ windowKey: workspace.frame.windowKey, role: workspace.role, partners: workspace.partners, alerts: alertsBadge(workspace.alerts, workspace.frame.windowKey), health: healthBadge(workspace.health), active: { kind: "alerts" } });
  const view = buildAlertsView({ alerts: workspace.alerts ?? { status: "error" }, filterKey, months: workspace.frame.months, partners: workspace.partners });
  return (
    <Shell nav={nav} frame={{ ...workspace.frame, chip: workspace.chip }} breadcrumb={[{ label: "Alerts" }]}>
      <AlertsPage view={view} />
    </Shell>
  );
}
