import type { SlaTermsProvider } from "./provider";

/** Returns no scopes. Tests use this when a case has no contract rows. */
export class EmptyTermsProvider implements SlaTermsProvider {
  listScopes: SlaTermsProvider["listScopes"] = async () => [];
}
