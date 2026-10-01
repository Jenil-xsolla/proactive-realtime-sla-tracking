import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  noStore();
  const { partner } = await params;
  if (!isPartnerId(partner)) {
    notFound();
  }
  const query = await searchParams;
  const edit = Array.isArray(query.edit) ? query.edit[0] : query.edit;
  const row = await readContractTermsForPartner(getDatabase(), partner);
  const name = partnerLabel(partner);
  const editing = edit === "1";

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-6">
      <Link
        href="/"
        className="text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Downtime
      </Link>
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
    </main>
  );
}
