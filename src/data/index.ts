export { createDatabase, getDatabase, type Database } from "./db";
export { parseMerchantId } from "./merchant-id";
export {
  loadOutages,
  partitionOutages,
  summarizeOutageHealth,
  UNUSABLE_REASONS,
  type OutageHealth,
  type OutagePartition,
  type OutageProvenance,
  type OutageSourceRow,
  type UnusableOutage,
  type UnusableReason,
  type UsableOutage,
} from "./outages";
export { classifyPartnerCoverage, type ObservedPartnerPair, type RegistryReport } from "./registry-report";
export { slaAlertState } from "./schema/alert-state";
export { slaOutages } from "./schema/outages";
