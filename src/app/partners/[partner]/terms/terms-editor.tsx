"use client";

import { useRouter } from "next/navigation";
import type { PartnerId } from "@/registry";
import type { ContractFormState } from "@/terms/review-contract";
import { TermsForm } from "./terms-form";

export function TermsEditor({
  partner,
  partnerName,
  initial,
}: {
  partner: PartnerId;
  partnerName: string;
  initial: ContractFormState;
}) {
  const router = useRouter();
  return (
    <TermsForm
      partner={partner}
      partnerName={partnerName}
      initial={initial}
      onSaved={() => {
        router.push(`/partners/${partner}/terms`);
        router.refresh();
      }}
      onReload={() => {
        router.refresh();
      }}
    />
  );
}
