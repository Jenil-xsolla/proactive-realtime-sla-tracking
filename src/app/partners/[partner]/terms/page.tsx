import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { alertsBadge, healthBadge, loadWorkspace } from "@/app/dashboard/load";
import { buildNav, withWindow } from "@/app/dashboard/nav";
import { Shell } from "@/app/shell/shell";
import { getDatabase, readContractTermsForPartner } from "@/data";
import { partnerLabel } from "@/feed";
import { isPartnerId } from "@/registry";
import { emptyContractForm } from "@/terms/review-contract";
import { formStateFromTerms } from "./form-state";
import { TermsEditor } from "./terms-editor";
import { TermsView } from "./terms-view";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PartnerTermsPage({
  params,
  searchParams,
}: {
  params: Promise<{ partner: string }>;
  searchParams: Promise<{ edit?: string | string[]; window?: string | string[] }>;
}) {
  noStore();
  const { partner } = await params;
  if (!isPartnerId(partner)) {
    notFound();
  }
  const query = await searchParams;
  const requested = Array.isArray(query.window) ? query.window[0] : query.window;
  const workspace = await loadWorkspace({ window: requested });
  if (workspace.role === "business") {
    notFound();
  }
  const nav = buildNav({
    windowKey: workspace.frame.windowKey,
    role: workspace.role,
    partners: workspace.partners,
    alerts: alertsBadge(workspace.alerts, workspace.frame.windowKey),
    health: healthBadge(workspace.health),
    active: { kind: "partner", id: partner },
  });
  const edit = Array.isArray(query.edit) ? query.edit[0] : query.edit;
  const row = await readContractTermsForPartner(getDatabase(), partner);
  const name = partnerLabel(partner);
  const editing = edit === "1";

  return (
    <Shell
      nav={nav}
      frame={{ ...workspace.frame, chip: workspace.chip }}
      showWindow={false}
      breadcrumb={[
        { label: "Overview", href: withWindow("/", workspace.frame.windowKey) },
        { label: name, href: withWindow(`/partners/${partner}`, workspace.frame.windowKey) },
        { label: "Contract terms" },
      ]}
    >
      {row !== null && !editing ? (
        <TermsView
          partner={partner}
          partnerName={name}
          lifecycle={row.lifecycle}
          updatedBy={row.updatedBy}
          updatedAt={row.updatedAt.toISOString()}
          terms={row.terms}
        />
      ) : (
        <TermsEditor
          key={row === null ? "new" : String(row.version)}
          partner={partner}
          partnerName={name}
          initial={row === null ? emptyContractForm() : formStateFromTerms(row.terms, row.version)}
        />
      )}
    </Shell>
  );
}
