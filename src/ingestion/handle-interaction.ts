import type { Database } from "@/data";
import { getIngestionDatabase } from "@/ingestion/db";
import {
  CORRECTION_CALLBACK_ID,
  correctionModal,
  parseCorrectionMetadata,
  parseCorrectionSubmission,
  type SlackViewLike,
} from "@/ingestion/notify/correction-modal";
import { captureMessage } from "@/ingestion/notify/messages";
import { triggerAlertRun } from "@/ingestion/notify/trigger-alerts";
import { buildCaptureRows, type CaptureRow } from "@/ingestion/resolution";
import {
  applyCorrection,
  getLatestCorrection,
  getOutageRows,
  getReviewForCorrection,
  getSlackRef,
  saveSlackMessage,
  type OutageRow,
} from "@/ingestion/writer";
import { openView, updateMessage, type OpenViewResult, type UpdateMessageResult } from "@/slack/client";

/**
 * Handles Slack's `/api/slack/interactions` payloads (spec §3 "Handling a
 * correction"): the Correct button's `block_actions` click opens the
 * correction modal, and the modal's `view_submission` applies the
 * correction. Never throws — every branch is caught and logged.
 * `block_actions` and an unrecognised payload always answer with a body
 * of `null` (an empty ack). A `view_submission` only answers `null` when
 * it isn't ours (a different callback_id); once it's ours, every path
 * answers with a real `response_action`, including failures — a null
 * body there would be an empty 200 that silently clears the modal, so the
 * corrector would believe an unsaved correction had saved. Everything
 * I/O-shaped is injected (`deps`), matching the `PirDeps`/`defaultPirDeps`
 * pattern in handle-pir.ts.
 *
 * `chat.update` and the alert trigger run in the caller's `after()`
 * (design §3), not before responding — so a successful correction
 * returns a `followUp` the route schedules there. `followUp` itself never
 * throws.
 */

export type InteractionOpenView = (input: { token: string; triggerId: string; view: unknown }) => Promise<OpenViewResult>;

export type InteractionUpdateMessage = (input: {
  token: string;
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}) => Promise<UpdateMessageResult>;

export type InteractionTriggerAlerts = () => Promise<{ ok: boolean; error?: string }>;

export type InteractionDeps = {
  db: Database;
  openView: InteractionOpenView;
  updateMessage: InteractionUpdateMessage;
  triggerAlerts: InteractionTriggerAlerts;
  now: () => Date;
  config: { slackToken: string };
  log?: (msg: string) => void;
};

export type InteractionResult = { body: unknown | null; followUp?: () => Promise<void> };

/**
 * A `view_submission` that fails for a reason the corrector didn't cause
 * (a thrown error, or a review that vanished between the Correct click and
 * the submission) must not return a null body: an empty 200 clears the
 * modal, so the corrector would believe it saved when it didn't (spec §3,
 * "Slack requires a response within three seconds" — the ack still has to
 * be honest). "partners" carries it because Slack requires an existing
 * input block_id for a view error and every correction has one.
 */
const SAVE_FAILED_ERROR = {
  response_action: "errors",
  errors: { partners: "Could not save the correction; try again." },
} as const;

/** See handle-pir.ts's describeError: Drizzle 0.45 wraps DB errors in
 * DrizzleQueryError, whose `.message` is the SQL text, not the reason;
 * the reason lives on `.cause`. Capped at the same length for consistency. */
const MAX_ERROR_CHARS = 500;

function truncateError(message: string): string {
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.cause instanceof Error ? error.cause.message : error.message;
    return truncateError(message);
  }
  return truncateError(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function handleSlackInteraction(payload: unknown, deps: InteractionDeps): Promise<InteractionResult> {
  const log = deps.log ?? (() => {});
  try {
    if (!isRecord(payload) || typeof payload.type !== "string") {
      return { body: null };
    }
    if (payload.type === "block_actions") {
      return await handleBlockActions(payload, deps, log);
    }
    if (payload.type === "view_submission") {
      return await handleViewSubmission(payload, deps, log);
    }
    return { body: null };
  } catch (error) {
    log(`handleSlackInteraction failed: ${describeError(error)}`);
    return { body: null };
  }
}

/**
 * The Correct button click (spec §3, "Slack requires a response within
 * three seconds"): loads the review and current rows, then opens the
 * correction modal. A PIR with no review — never captured — is logged and
 * answered with `null`; there is nothing to correct.
 */
async function handleBlockActions(
  payload: Record<string, unknown>,
  deps: InteractionDeps,
  log: (msg: string) => void,
): Promise<InteractionResult> {
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const first = actions[0];
  if (!isRecord(first) || first.action_id !== "correct" || typeof first.value !== "string") {
    return { body: null };
  }
  const pirKey = first.value;
  const triggerId = typeof payload.trigger_id === "string" ? payload.trigger_id : undefined;
  if (!triggerId) {
    log(`correct click for ${pirKey} had no trigger_id`);
    return { body: null };
  }

  const review = await getReviewForCorrection(deps.db, pirKey);
  if (!review) {
    log(`correct click for ${pirKey}: no captured review found`);
    return { body: null };
  }

  const rows = await getOutageRows(deps.db, pirKey);
  const view = correctionModal({ pirKey, version: review.version, rows, review: review.extracted });

  const result = await deps.openView({ token: deps.config.slackToken, triggerId, view });
  if (!result.ok) {
    log(`openView failed for ${pirKey}: ${result.error}`);
  }
  return { body: null };
}

/**
 * The correction modal's submission (spec §3 "Handling a correction"
 * steps 2–4). Every failure past the username check — malformed
 * `private_metadata`, a review that's gone missing, `applyCorrection`
 * throwing — is answered with `SAVE_FAILED_ERROR`, not a null body: a
 * null body is an empty 200, which clears the modal and tells the
 * corrector it saved when it didn't. Field-level validation
 * (`parseCorrectionSubmission` returning `ok: false`) and a stale version
 * are expected outcomes, not failures, and keep their own specific
 * errors.
 */
async function handleViewSubmission(
  payload: Record<string, unknown>,
  deps: InteractionDeps,
  log: (msg: string) => void,
): Promise<InteractionResult> {
  const view = payload.view;
  if (!isRecord(view) || view.callback_id !== CORRECTION_CALLBACK_ID) {
    return { body: null };
  }

  const user = payload.user;
  const username = isRecord(user) && typeof user.username === "string" && user.username.trim() !== "" ? user.username : undefined;
  if (!username) {
    return {
      body: {
        response_action: "errors",
        errors: { reason: "Your Slack username could not be read; the correction was not saved." },
      },
    };
  }

  try {
    const metadata = parseCorrectionMetadata(typeof view.private_metadata === "string" ? view.private_metadata : "");

    const [currentRows, review] = await Promise.all([
      getOutageRows(deps.db, metadata.pirKey),
      getReviewForCorrection(deps.db, metadata.pirKey),
    ]);

    if (!review) {
      log(`view_submission for ${metadata.pirKey}: no review found; correction not saved`);
      return { body: SAVE_FAILED_ERROR };
    }

    const parsed = parseCorrectionSubmission(view as SlackViewLike, { currentRows });
    if (!parsed.ok) {
      return { body: { response_action: "errors", errors: parsed.errors } };
    }

    const pirUrl = review.extracted.pirUrl;
    const afterRows = buildCaptureRows(
      {
        pirKey: metadata.pirKey,
        pirUrl,
        severity: parsed.extracted.severity,
        outageMinutes: parsed.extracted.outageMinutes,
        incidentStarted: parsed.extracted.incidentStarted,
      },
      parsed.partners,
      parsed.services,
    );

    const now = deps.now();
    const result = await applyCorrection(
      deps.db,
      {
        pirKey: metadata.pirKey,
        expectedVersion: metadata.version,
        after: afterRows,
        extracted: { ...parsed.extracted, pirUrl },
        reason: parsed.reason,
        correctedBy: username,
      },
      now,
    );

    if (result.kind === "stale") {
      return {
        body: {
          response_action: "errors",
          errors: { partners: "someone else just corrected this; reopen to see the latest." },
        },
      };
    }

    const followUp = buildFollowUp(deps, metadata.pirKey, pirUrl, { by: username, at: now }, log);
    return { body: { response_action: "clear" }, followUp };
  } catch (error) {
    log(`view_submission failed: ${describeError(error)}`);
    return { body: SAVE_FAILED_ERROR };
  }
}

function toCaptureRow(pirKey: string, fallbackPirUrl: string, row: OutageRow): CaptureRow {
  return {
    pirKey,
    partner: row.partner,
    partnerId: row.partnerId,
    affectedService: row.affectedService,
    incidentStarted: row.incidentStarted,
    outageMinutes: row.outageMinutes,
    severity: row.severity ?? "",
    pirUrl: row.pirUrl ?? fallbackPirUrl,
  };
}

/**
 * Builds the applied correction's `followUp` (spec §3 step 4): edits
 * the capture message and triggers the alert run after the response has
 * gone out. Re-reads the PIR's current rows, review and latest correction
 * at the moment it actually runs, rather than closing over the snapshot
 * from submission time — `after()` callbacks are not guaranteed to run in
 * submission order, so a stale closure could overwrite a newer correction's
 * message with older values. Never throws.
 */
function buildFollowUp(
  deps: InteractionDeps,
  pirKey: string,
  fallbackPirUrl: string,
  submissionCorrection: { by: string; at: Date },
  log: (msg: string) => void,
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      const [latestRows, latestReview, latestCorrection] = await Promise.all([
        getOutageRows(deps.db, pirKey),
        getReviewForCorrection(deps.db, pirKey),
        getLatestCorrection(deps.db, pirKey),
      ]);
      const pirUrl = latestReview?.extracted.pirUrl ?? fallbackPirUrl;
      const rows = latestRows.map((row) => toCaptureRow(pirKey, pirUrl, row));

      const message = captureMessage({
        pirKey,
        pirUrl,
        rows,
        unresolved: [],
        nonPilotIdCount: 0,
        lastCorrection: latestCorrection ?? submissionCorrection,
      });
      const ref = await getSlackRef(deps.db, pirKey);
      if (ref?.slackTs) {
        const channel = ref.slackChannel ?? "";
        const updateResult = await deps.updateMessage({
          token: deps.config.slackToken,
          channel,
          ts: ref.slackTs,
          text: message.text,
          blocks: message.blocks,
        });
        if (updateResult.ok) {
          try {
            await saveSlackMessage(deps.db, pirKey, { channel, ts: ref.slackTs }, deps.now());
          } catch (error) {
            log(`saveSlackMessage failed for ${pirKey}: ${describeError(error)}`);
          }
        } else {
          // Spec §4: "the correction is saved; logged, not retried."
          log(`chat.update failed for ${pirKey}: ${updateResult.error}`);
        }
      } else {
        log(`no saved Slack message for ${pirKey}; correction saved without an edit`);
      }
    } catch (error) {
      log(`follow-up message edit failed for ${pirKey}: ${describeError(error)}`);
    }

    try {
      const alertResult = await deps.triggerAlerts();
      if (!alertResult.ok) {
        log(`triggerAlerts failed for ${pirKey}: ${alertResult.error ?? "unknown error"}`);
      }
    } catch (error) {
      log(`triggerAlerts threw for ${pirKey}: ${describeError(error)}`);
    }
  };
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * Builds the production `InteractionDeps`: the real ingestion database and
 * Slack client, mirroring `defaultPirDeps` in handle-pir.ts. Throws a
 * clear error naming the first missing environment variable; the route
 * catches it.
 */
export function defaultInteractionDeps(env: Record<string, string | undefined> = process.env): InteractionDeps {
  return {
    db: getIngestionDatabase(),
    openView,
    updateMessage,
    triggerAlerts: () => triggerAlertRun(),
    now: () => new Date(),
    config: { slackToken: requireEnv(env, "SLACK_BOT_TOKEN") },
    log: (msg: string) => {
      console.error(msg);
    },
  };
}

/**
 * The public entry point for the `/api/slack/interactions` route: builds
 * the default deps and runs the flow, mirroring `runPirApproved` in
 * handle-pir.ts. This, not `defaultInteractionDeps`, is what
 * `src/ingestion/index.ts` exports, so nothing outside `src/ingestion` ever
 * holds an `InteractionDeps` (and therefore the ingestion database client)
 * directly. Throws the same config error `defaultInteractionDeps` throws;
 * the route catches it.
 */
export async function runSlackInteraction(payload: unknown): Promise<InteractionResult> {
  const deps = defaultInteractionDeps();
  return handleSlackInteraction(payload, deps);
}
