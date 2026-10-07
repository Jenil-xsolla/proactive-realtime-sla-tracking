import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { alertsBadge, healthBadge, loadWorkspace } from "@/app/dashboard/load";
import { buildNav, withWindow } from "@/app/dashboard/nav";
import { buildPartnerPage } from "@/app/dashboard/partner-page";
import { PartnerPageView } from "@/app/dashboard/partner-page-view";
import { Shell } from "@/app/shell/shell";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ partner: string }>;
  searchParams: Promise<{ window?: string | string[]; backtest?: string | string[] }>;
}) {
  noStore();
  const { partner: id } = await params;
  const query = await searchParams;
  const workspace = await loadWorkspace({
    window: single(query.window),
    windowPath: `/partners/${id}`,
    backtestPartner: single(query.backtest) === "1" ? id : undefined,
  });
  const partner = workspace.partners.find((entry) => entry.id === id);
  if (partner === undefined) {
    notFound();
  }
  const nav = buildNav({
    windowKey: workspace.frame.windowKey,
    role: workspace.role,
    partners: workspace.partners,
    alerts: alertsBadge(workspace.alerts, workspace.frame.windowKey),
    health: healthBadge(workspace.health),
    active: { kind: "partner", id },
  });
  const view = buildPartnerPage({ partner, phase: workspace.frame.phase, windowKey: workspace.frame.windowKey, failure: workspace.failure, role: workspace.role });
  const backtest = workspace.backtest !== null && workspace.backtest.partner === id ? workspace.backtest.panel : null;
  return (
    <Shell nav={nav} frame={{ ...workspace.frame, chip: workspace.chip }} breadcrumb={[{ label: "← Overview", href: withWindow("/", workspace.frame.windowKey) }, { label: partner.name }]}>
      <PartnerPageView view={view} backtest={backtest} />
    </Shell>
  );
}
