import type { PartnerId } from "@/registry";
import { HAND_AUTHORED_CONTRACTS } from "./contracts";
import { loadContractFile } from "./load-contract";
import type { SlaTermsProvider } from "./provider";
import { scopesForPartner } from "./select";
import type { HandAuthoredTermsFile, SlaScope } from "./types";

/** Reads the hand-authored files in `src/terms/contracts/` and converts each one. */
export class StaticTermsProvider implements SlaTermsProvider {
  constructor(
    private readonly files: readonly HandAuthoredTermsFile[] = HAND_AUTHORED_CONTRACTS,
  ) {}

  async listScopes(partner: PartnerId, asOf: Date): Promise<SlaScope[]> {
    return scopesForPartner(
      this.files.map((file) => ({
        partner: file.partner,
        example: file.example,
        lifecycle: file.lifecycle,
        scopes: loadContractFile(file).scopes,
      })),
      partner,
      asOf,
    );
  }
}
