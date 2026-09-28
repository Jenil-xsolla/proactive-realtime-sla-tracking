import type { Database } from "@/data";
import { getIngestionDatabase } from "@/ingestion/db";
import { INCIDENT_FIELDS, PIR_FIELDS, fetchIssue, type JiraFetchResult } from "@/ingestion/jira/client";
import { readIncidentStart, readPir } from "@/ingestion/jira/extract";
import { buildCaptureRows, resolveMerchantText, resolveServiceAris, type CaptureRow } from "@/ingestion/resolution";
import { captureMessage, correctedAfterJiraChangeNote, failureNotice } from "@/ingestion/notify/messages";
import { triggerAlertRun } from "@/ingestion/notify/trigger-alerts";
import {
  captureRows,
  getSlackRef,
  markFailed,
  markSkipped,
  recordReceipt,
  saveSlackError,
  saveSlackMessage,
  type ExtractedValues,
} from "@/ingestion/writer";
import { postMessage, updateMessage, type PostMessageResult, type UpdateMessageResult } from "@/slack/client";

/**
 * Orchestrates one Jira PIR end to end (spec §2 "Ingestion flow"): receipt,
 * Jira fetch, extraction, resolution, write, Slack, alert trigger. Every
 * building block is injected so this function has no I/O of its own beyond
 * calling `deps`. Never throws — every terminal state is a `PirOutcome`.
 */

/** The subset of fetchIssue's real signature this flow calls. */
export type PirFetchIssue = (input: { key: string; fields: string[] }) => Promise<JiraFetchResult>;

export type PirPostMessage = (input: {
  token: string;
  channel: string;
  text: string;
  blocks?: unknown[];
}) => Promise<PostMessageResult>;

export type PirUpdateMessage = (input: {
  token: string;
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}) => Promise<UpdateMessageResult>;

export type PirDeps = {
  db: Database;
  fetchIssue: PirFetchIssue;
  postMessage: PirPostMessage;
  updateMessage: PirUpdateMessage;
  triggerAlerts: () => Promise<{ ok: boolean; error?: string }>;
  now: () => Date;
  config: { jiraBaseUrl: string; slackToken: string; slackChannel: string };
  log?: (msg: string) => void;
};

export type PirOutcome =
  | { kind: "captured"; rowCount: number; messagePosted: boolean }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string }
  | { kind: "corrected_untouched" }
  | { kind: "receipt_failed"; error: string };

/** Builds the same pir_url shape as jira/extract.ts's (unexported) buildPirUrl. */
function buildPirUrl(baseUrl: string, pirKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/browse/${pirKey}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handlePirApproved(issueKey: string, deps: PirDeps): Promise<PirOutcome> {
  const log = deps.log ?? (() => {});
  const now = deps.now();

  try {
    await recordReceipt(deps.db, issueKey, now);
  } catch (error) {
    const message = describeError(error);
    log(`recordReceipt failed for ${issueKey}: ${message}`);
    await postNoticeBestEffort(deps, issueKey, undefined, message, log);
    return { kind: "receipt_failed", error: message };
  }

  const pirFetch = await deps.fetchIssue({ key: issueKey, fields: PIR_FIELDS });
  if (!pirFetch.ok) {
    return fail(deps, issueKey, undefined, pirFetch.error, now, log);
  }

  const read = readPir(pirFetch.json, deps.config.jiraBaseUrl);
  if (read.kind === "skip") {
    try {
      await markSkipped(deps.db, issueKey, read.reason, now);
    } catch (error) {
      log(`markSkipped failed for ${issueKey}: ${describeError(error)}`);
    }
    return { kind: "skipped", reason: read.reason };
  }
  if (read.kind === "invalid") {
    return fail(deps, issueKey, undefined, read.problems.join("; "), now, log);
  }

  const pir = read.value;

  const incidentFetch = await deps.fetchIssue({ key: pir.incidentKey, fields: INCIDENT_FIELDS });
  if (!incidentFetch.ok) {
    return fail(deps, issueKey, pir.pirUrl, incidentFetch.error, now, log);
  }
  const incidentStarted = readIncidentStart(incidentFetch.json);
  if (incidentStarted === null) {
    return fail(deps, issueKey, pir.pirUrl, `incident start time missing on ${pir.incidentKey}`, now, log);
  }

  const merchantResolution = resolveMerchantText(pir.merchantText);
  const serviceResolution = resolveServiceAris(pir.serviceAris);
  const unresolved = [...merchantResolution.unresolved, ...serviceResolution.unresolved];
  const rows: CaptureRow[] = buildCaptureRows(
    {
      pirKey: pir.pirKey,
      pirUrl: pir.pirUrl,
      severity: pir.severity,
      outageMinutes: pir.outageMinutes,
      incidentStarted,
    },
    merchantResolution.partners,
    serviceResolution.services,
  );

  const extracted: ExtractedValues = {
    incidentStarted,
    outageMinutes: pir.outageMinutes,
    affectedServices: serviceResolution.services.map((service) => service.displayName),
    severity: pir.severity,
    pirUrl: pir.pirUrl,
  };

  let captureResult;
  try {
    captureResult = await captureRows(deps.db, { pirKey: pir.pirKey, extracted, rows, unresolved }, now);
  } catch (error) {
    return fail(deps, issueKey, pir.pirUrl, describeError(error), now, log);
  }

  if (captureResult.kind === "corrected_untouched") {
    const note = correctedAfterJiraChangeNote({ pirKey: pir.pirKey, pirUrl: pir.pirUrl });
    await postMessageBestEffort(deps, note, log);
    return { kind: "corrected_untouched" };
  }

  const message = captureMessage({
    pirKey: pir.pirKey,
    pirUrl: pir.pirUrl,
    rows,
    unresolved,
    nonPilotIdCount: merchantResolution.nonPilotIdCount,
  });

  const messagePosted = await deliverCaptureMessage(deps, pir.pirKey, message, now, log);

  try {
    const triggerResult = await deps.triggerAlerts();
    if (!triggerResult.ok) {
      log(`triggerAlerts failed for ${issueKey}: ${triggerResult.error ?? "unknown error"}`);
    }
  } catch (error) {
    log(`triggerAlerts threw for ${issueKey}: ${describeError(error)}`);
  }

  return { kind: "captured", rowCount: captureResult.rowCount, messagePosted };
}

/**
 * Posts or edits the capture message (spec §2 step 6, A9): edits the saved
 * message in place when one already exists for this PIR, otherwise posts a
 * new one and saves its reference. A Slack rejection (or a thrown error) is
 * recorded as `slack_error`; rows stay written either way (spec §4).
 */
async function deliverCaptureMessage(
  deps: PirDeps,
  pirKey: string,
  message: { text: string; blocks: unknown[] },
  now: Date,
  log: (msg: string) => void,
): Promise<boolean> {
  try {
    const ref = await getSlackRef(deps.db, pirKey);
    if (ref?.slackTs) {
      const result = await deps.updateMessage({
        token: deps.config.slackToken,
        channel: ref.slackChannel ?? deps.config.slackChannel,
        ts: ref.slackTs,
        text: message.text,
        blocks: message.blocks,
      });
      if (result.ok) {
        return true;
      }
      await saveSlackErrorBestEffort(deps, pirKey, result.error, now, log);
      return false;
    }

    const result = await deps.postMessage({
      token: deps.config.slackToken,
      channel: deps.config.slackChannel,
      text: message.text,
      blocks: message.blocks,
    });
    if (!result.ok) {
      await saveSlackErrorBestEffort(deps, pirKey, result.error, now, log);
      return false;
    }
    try {
      await saveSlackMessage(deps.db, pirKey, { channel: result.channel, ts: result.ts }, now);
    } catch (error) {
      log(`saveSlackMessage failed for ${pirKey}: ${describeError(error)}`);
    }
    return true;
  } catch (error) {
    log(`posting the capture message failed for ${pirKey}: ${describeError(error)}`);
    return false;
  }
}

async function saveSlackErrorBestEffort(
  deps: PirDeps,
  pirKey: string,
  error: string,
  now: Date,
  log: (msg: string) => void,
): Promise<void> {
  try {
    await saveSlackError(deps.db, pirKey, error, now);
  } catch (dbError) {
    log(`saveSlackError failed for ${pirKey}: ${describeError(dbError)}`);
  }
}

async function postMessageBestEffort(
  deps: PirDeps,
  message: { text: string; blocks: unknown[] },
  log: (msg: string) => void,
): Promise<void> {
  try {
    const result = await deps.postMessage({
      token: deps.config.slackToken,
      channel: deps.config.slackChannel,
      text: message.text,
      blocks: message.blocks,
    });
    if (!result.ok) {
      log(`posting a Slack notice failed: ${result.error}`);
    }
  } catch (error) {
    log(`posting a Slack notice failed: ${describeError(error)}`);
  }
}

/**
 * "failed" (spec §2 "On failure at any step"): marks the review failed,
 * then posts the failure notice, best effort at every step. Never throws.
 */
async function fail(
  deps: PirDeps,
  pirKey: string,
  pirUrl: string | undefined,
  error: string,
  now: Date,
  log: (msg: string) => void,
): Promise<PirOutcome> {
  try {
    await markFailed(deps.db, pirKey, error, now);
  } catch (markError) {
    log(`markFailed failed for ${pirKey}: ${describeError(markError)}`);
  }
  await postNoticeBestEffort(deps, pirKey, pirUrl, error, log);
  return { kind: "failed", error };
}

async function postNoticeBestEffort(
  deps: PirDeps,
  pirKey: string,
  pirUrl: string | undefined,
  error: string,
  log: (msg: string) => void,
): Promise<void> {
  const message = failureNotice({
    pirKey,
    pirUrl: pirUrl ?? buildPirUrl(deps.config.jiraBaseUrl, pirKey),
    error,
  });
  await postMessageBestEffort(deps, message, log);
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * Builds the production `PirDeps`: the real ingestion database, the real
 * Jira and Slack clients, and the real alert trigger. Throws a clear error
 * naming the first missing environment variable; the route catches it.
 */
export function defaultPirDeps(env: Record<string, string | undefined> = process.env): PirDeps {
  return {
    db: getIngestionDatabase(),
    fetchIssue,
    postMessage,
    updateMessage,
    triggerAlerts: () => triggerAlertRun(),
    now: () => new Date(),
    config: {
      jiraBaseUrl: requireEnv(env, "JIRA_BASE_URL"),
      slackToken: requireEnv(env, "SLACK_BOT_TOKEN"),
      slackChannel: requireEnv(env, "SLACK_CHANNEL_INGESTION"),
    },
    log: (msg: string) => {
      console.error(msg);
    },
  };
}
