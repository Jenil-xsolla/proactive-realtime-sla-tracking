/**
 * Public entry point for src/ingestion. Everything outside this module
 * imports from here, not from individual files: the row-capturing module
 * and the ingestion database client are intentionally not re-exported,
 * and ESLint (see eslint.config.mjs) enforces that only code inside
 * src/ingestion/** may reach them directly.
 */
export { PIR_FIELDS, INCIDENT_FIELDS, fetchIssue } from "./jira/client";
export type { JiraFetchResult } from "./jira/client";
export { readPir, readIncidentStart } from "./jira/extract";
export type { PirRead, PirReadValue } from "./jira/extract";
export {
  resolveMerchantText,
  resolveServiceAris,
  buildCaptureRows,
} from "./resolution";
export type { ResolvedPartner, CaptureRow } from "./resolution";
