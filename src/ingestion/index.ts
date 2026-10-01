/**
 * Public entry point for src/ingestion. Everything outside this module
 * imports from here, not from individual files: the row-capturing module
 * and the ingestion database client are intentionally not re-exported,
 * and ESLint (see eslint.config.mjs) enforces that only code inside
 * src/ingestion/** may reach them directly.
 *
 * `runPirApproved`/`runSlackInteraction` are the only entry points the two
 * routes use — not the default-deps builders or the flow functions they
 * call, which hand a deps object (and therefore the ingestion database
 * client) to the caller. Only symbols something outside src/ingestion
 * actually imports are exported here; everything else is reached through
 * the internal module path, which ESLint allows for tests.
 */
export { verifySlackRequest } from "./notify/verify";
export type { SlackVerifyResult } from "./notify/verify";
export { triggerAlertRun } from "./notify/trigger-alerts";
export type { TriggerAlertRunResult } from "./notify/trigger-alerts";
export { runPirApproved } from "./handle-pir";
export { runSlackInteraction } from "./handle-interaction";
