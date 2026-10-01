import type { PartnerId } from "@/registry";
import { loadContractFile } from "./load-contract";
import type { SlaTermsProvider } from "./provider";
import { scopesForPartner } from "./select";
import type { ContractFile, SlaScope } from "./types";

/**
 * A row of `sla_contract_terms` as the data layer returns it. This module
 * does not import the database; the caller supplies the rows.
 */
export type StoredContractRow = {
  partnerSlug: string;
  lifecycle: string;
  terms: unknown;
};

/** A stored row `loadContractFile` rejected. It scores nothing. */
export type InvalidContractTerms = {
  partner: string;
  message: string;
};

type PreparedRow = { kind: "skip" } | { kind: "bound"; scopes: SlaScope[] };

/**
 * Production terms provider. Converts each stored row with `loadContractFile`
 * and returns scopes only for `contract_bound` rows whose window contains
 * `asOf`. A row that fails validation is recorded on `invalidTerms` and
 * contributes no scopes, so one bad partner does not reject the rest.
 */
export class DbTermsProvider implements SlaTermsProvider {
  invalidTerms: InvalidContractTerms[] = [];
  private prepared: Promise<Map<string, PreparedRow>> | undefined;

  constructor(private readonly readRows: () => Promise<readonly StoredContractRow[]>) {}

  async load(): Promise<void> {
    await this.rows();
  }

  async listScopes(partner: PartnerId, asOf: Date): Promise<SlaScope[]> {
    const prepared = await this.rows();
    const row = prepared.get(partner);
    if (row === undefined || row.kind !== "bound") {
      return [];
    }
    return scopesForPartner(
      [{ partner, lifecycle: "contract_bound", scopes: row.scopes }],
      partner,
      asOf,
    );
  }

  private rows(): Promise<Map<string, PreparedRow>> {
    this.prepared ??= this.readRows().then((loaded) => this.prepare(loaded));
    return this.prepared;
  }

  private prepare(loaded: readonly StoredContractRow[]): Map<string, PreparedRow> {
    const prepared = new Map<string, PreparedRow>();
    const invalid: InvalidContractTerms[] = [];
    for (const row of loaded) {
      try {
        const file = contractFile(row);
        const loadedFile = loadContractFile(file);
        if (file.lifecycle !== "contract_bound") {
          prepared.set(row.partnerSlug, { kind: "skip" });
          continue;
        }
        prepared.set(row.partnerSlug, { kind: "bound", scopes: loadedFile.scopes });
      } catch (error) {
        invalid.push({
          partner: row.partnerSlug,
          message: error instanceof Error ? error.message : "Contract terms could not be validated.",
        });
        prepared.set(row.partnerSlug, { kind: "skip" });
      }
    }
    this.invalidTerms = invalid;
    return prepared;
  }
}

function contractFile(row: StoredContractRow): ContractFile {
  const stored = row.terms;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new Error(`Contract terms for ${row.partnerSlug} are not an object.`);
  }
  if (row.lifecycle !== "terms_pending_review" && row.lifecycle !== "contract_bound") {
    throw new Error(
      `Contract terms for ${row.partnerSlug} have lifecycle "${row.lifecycle}". A row is terms_pending_review or contract_bound.`,
    );
  }
  const body = stored as Partial<ContractFile>;
  return {
    partner: row.partnerSlug as PartnerId,
    lifecycle: row.lifecycle,
    effectiveFrom: body.effectiveFrom ?? "",
    effectiveTo: body.effectiveTo === undefined ? null : body.effectiveTo,
    scopes: body.scopes as ContractFile["scopes"],
    contractAggregateCap: body.contractAggregateCap === undefined ? null : body.contractAggregateCap,
  };
}
