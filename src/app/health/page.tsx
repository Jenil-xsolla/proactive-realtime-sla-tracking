import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { HealthPage } from "@/app/dashboard/health-page";
import { alertsBadge, healthBadge, loadWorkspace } from "@/app/dashboard/load";
import { unusableRows } from "@/app/dashboard/model";
import { buildNav } from "@/app/dashboard/nav";
import { Shell } from "@/app/shell/shell";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function HealthRoute() {
  noStore();
  const workspace = await loadWorkspace({});
  if (workspace.role === "business") {
    notFound();
  }
  const nav = buildNav({ windowKey: workspace.frame.windowKey, role: workspace.role, partners: workspace.partners, alerts: alertsBadge(workspace.alerts, workspace.frame.windowKey), health: healthBadge(workspace.health), active: { kind: "health" } });
  return (
    <Shell nav={nav} frame={{ ...workspace.frame, chip: workspace.chip }} breadcrumb={[{ label: "Health" }]}>
      <HealthPage health={workspace.health ?? { status: "error" }} unusable={workspace.unusable === null ? null : unusableRows(workspace.unusable)} />
    </Shell>
  );
}
