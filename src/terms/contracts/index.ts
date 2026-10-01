import { EXAMPLE_NOT_A_CONTRACT } from "./example.not-a-contract";

/**
 * Files `StaticTermsProvider` reads when a test does not pass its own.
 * The example is the only file. Production terms are rows in sla_contract_terms.
 */
export const HAND_AUTHORED_CONTRACTS = [EXAMPLE_NOT_A_CONTRACT];
