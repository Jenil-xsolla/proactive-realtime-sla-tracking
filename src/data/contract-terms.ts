import { and, asc, eq } from "drizzle-orm";
import type { PartnerId } from "@/registry";
import { loadContractFile } from "@/terms/load-contract";
import type { ContractFile, ContractTermsBody } from "@/terms/types";
import type { Database } from "./db";
import { slaContractTerms } from "./schema/contract-terms";

export type { ContractTermsBody };

export type ContractTermsRow = {
  partnerSlug: string;
  lifecycle: string;
  terms: ContractFile;
  version: number;
  updatedBy: string;
  updatedAt: Date;
  createdAt: Date;
};

export type SaveContractTermsResult = { kind: "saved"; version: number } | { kind: "conflict" };

/**
 * Every current terms row, one per partner. Ordered by slug so a caller
 * that reports failures does so in a stable order.
 */
export async function readContractTerms(db: Database): Promise<ContractTermsRow[]> {
  return db.select().from(slaContractTerms).orderBy(asc(slaContractTerms.partnerSlug));
}

export async function readContractTermsForPartner(
  db: Database,
  partner: PartnerId,
): Promise<ContractTermsRow | null> {
  const rows = await db
    .select()
    .from(slaContractTerms)
    .where(eq(slaContractTerms.partnerSlug, partner));
  return rows[0] ?? null;
}

/**
 * Validates `terms` with `loadContractFile`, then writes one row.
 *
 * `expectedVersion` null means the caller believes no row exists, and this
 * inserts version 1. A number updates only where `version` equals it, then
 * increments. A mismatch, including a create against a row that already
 * exists, returns `conflict` and writes nothing.
 */
export async function saveContractTerms(
  db: Database,
  partner: PartnerId,
  terms: ContractTermsBody,
  lifecycle: ContractFile["lifecycle"],
  updatedBy: string,
  expectedVersion: number | null,
): Promise<SaveContractTermsResult> {
  const editor = updatedBy.trim();
  if (editor === "") {
    throw new Error("updatedBy is required.");
  }

  const file: ContractFile = {
    partner,
    lifecycle,
    effectiveFrom: terms.effectiveFrom,
    effectiveTo: terms.effectiveTo,
    scopes: terms.scopes,
    contractAggregateCap: terms.contractAggregateCap,
  };
  loadContractFile(file);

  const now = new Date();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: slaContractTerms.version })
      .from(slaContractTerms)
      .where(eq(slaContractTerms.partnerSlug, partner))
      .for("update");
    const row = existing[0];

    if (row === undefined) {
      if (expectedVersion !== null) {
        return { kind: "conflict" };
      }
      const inserted = await tx
        .insert(slaContractTerms)
        .values({
          partnerSlug: partner,
          lifecycle,
          terms: file,
          version: 1,
          updatedBy: editor,
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoNothing({ target: slaContractTerms.partnerSlug })
        .returning({ version: slaContractTerms.version });
      const saved = inserted[0];
      if (saved === undefined) {
        return { kind: "conflict" };
      }
      return { kind: "saved", version: saved.version };
    }

    if (expectedVersion === null || row.version !== expectedVersion) {
      return { kind: "conflict" };
    }

    const updated = await tx
      .update(slaContractTerms)
      .set({
        lifecycle,
        terms: file,
        version: row.version + 1,
        updatedBy: editor,
        updatedAt: now,
      })
      .where(and(eq(slaContractTerms.partnerSlug, partner), eq(slaContractTerms.version, expectedVersion)))
      .returning({ version: slaContractTerms.version });
    const saved = updated[0];
    if (saved === undefined) {
      return { kind: "conflict" };
    }
    return { kind: "saved", version: saved.version };
  });
}
