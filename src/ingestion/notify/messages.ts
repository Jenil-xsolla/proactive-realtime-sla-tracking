import type { UnresolvedValue } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";

/**
 * Pure builders for the Slack messages ingestion posts to the engineering
 * channel (design §3 "Capture message", §4 failure table). No I/O: each
 * function returns `{ text, blocks }` for chat.postMessage/chat.update.
 * Blocks are typed minimally and locally; there is no Slack SDK dependency.
 */

type SectionBlock = { type: "section"; text: { type: "mrkdwn"; text: string } };
type ContextBlock = { type: "context"; elements: { type: "mrkdwn"; text: string }[] };
type ButtonElement = {
  type: "button";
  text: { type: "plain_text"; text: string };
  action_id: string;
  value: string;
};
type ActionsBlock = { type: "actions"; elements: ButtonElement[] };

export type SlackBlock = SectionBlock | ContextBlock | ActionsBlock;

export type SlackMessage = { text: string; blocks: SlackBlock[] };

export type LastCorrection = { by: string; at: Date };

/** Slack rejects a message if any section's text exceeds this. */
const MAX_SECTION_CHARS = 3000;
/** An unresolved raw can be a whole prose paragraph; keep it short in the message. */
const UNRESOLVED_RAW_MAX = 500;

export type CaptureMessageInput = {
  pirKey: string;
  pirUrl: string;
  rows: CaptureRow[];
  unresolved: UnresolvedValue[];
  nonPilotIdCount: number;
  lastCorrection?: LastCorrection;
};

/**
 * Builds the capture-message posted to the engineering channel (spec §3):
 * a heading linking the PIR key, an optional unresolved-values warning, and
 * one field line each for affected partners, affected service(s), outage
 * minutes, severity, incident start and (when relevant) the non-pilot
 * count — normally all one section, kept at or under Slack's 3000-char
 * section limit; the block count stays small and well under Slack's
 * 50-block cap regardless. The `text` fallback is kept short (the header
 * line only), since Slack only shows it in places (like notifications)
 * that don't render blocks.
 */
export function captureMessage(input: CaptureMessageInput): SlackMessage {
  const { pirKey, pirUrl, rows, unresolved, nonPilotIdCount, lastCorrection } = input;
  const headerLine = `${pirKey} captured. It will appear on the dashboard.`;

  const headingText = `*${link(pirUrl, pirKey)} captured.* It will appear on the dashboard.`;
  const unresolvedLine = unresolved.length > 0 ? formatUnresolvedLine(unresolved) : null;
  const fieldsLines = buildFieldsLines(rows, nonPilotIdCount);

  const combinedText = [
    headingText,
    "",
    ...(unresolvedLine ? [unresolvedLine] : []),
    ...fieldsLines,
  ].join("\n");

  // Slack rejects a section over 3000 chars. The fields are always short, so
  // if the combined text is too long it's the unresolved line (a raw value
  // can be a whole prose paragraph, even truncated) — split it into its own
  // section rather than the fields.
  const mainSections: SectionBlock[] =
    combinedText.length <= MAX_SECTION_CHARS
      ? [section(combinedText)]
      : [
          section([headingText, "", ...(unresolvedLine ? [unresolvedLine] : [])].join("\n")),
          section(fieldsLines.join("\n")),
        ];

  const actionsBlock: ActionsBlock = {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Correct" },
        action_id: "correct",
        value: pirKey,
      },
    ],
  };

  const footerBlock: ContextBlock | null = lastCorrection
    ? {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Last corrected by ${escapeMrkdwn(lastCorrection.by)} at ${formatUtc(lastCorrection.at)}`,
          },
        ],
      }
    : null;

  // Fixed, small block count (main section(s), actions, optional footer) —
  // always well under Slack's 50-block cap.
  const blocks: SlackBlock[] = [...mainSections, actionsBlock];
  if (footerBlock) {
    blocks.push(footerBlock);
  }

  return { text: headerLine, blocks };
}

export type FailureNoticeInput = { pirKey: string; pirUrl: string; error: string };

/** Caps how much of a raw error string a Slack notice will render, independent
 * of any truncation the caller already did — a defense against a caller that
 * passes an untruncated string straight through (e.g. a raw Jira error). */
const MAX_ERROR_CHARS = 500;

function truncateError(error: string): string {
  return error.length > MAX_ERROR_CHARS ? `${error.slice(0, MAX_ERROR_CHARS)}…` : error;
}

/** Short notice for a PIR that failed to capture (spec §4 failure table). No button. */
export function failureNotice(input: FailureNoticeInput): SlackMessage {
  const text = `${input.pirKey} failed to capture.`;
  const blocks: SlackBlock[] = [
    section(`${text}\n${link(input.pirUrl, input.pirKey)}\n${escapeMrkdwn(truncateError(input.error))}`),
  ];
  return { text, blocks };
}

export type CorrectedAfterJiraChangeNoteInput = { pirKey: string; pirUrl: string };

/**
 * Note that Jira changed a PIR that has already been corrected (spec §2
 * "Redelivery"), so a person decides. No button.
 */
export function correctedAfterJiraChangeNote(input: CorrectedAfterJiraChangeNoteInput): SlackMessage {
  const text = `${input.pirKey} changed in Jira after a correction. It was left untouched; please check it.`;
  const blocks: SlackBlock[] = [section(`${text}\n${link(input.pirUrl, input.pirKey)}`)];
  return { text, blocks };
}

export type JiraDowngradedReason = "no_outage" | "below_l2";

export type JiraDowngradedNoteInput = { pirKey: string; pirUrl: string; reason: JiraDowngradedReason };

/**
 * Note that an already-captured PIR's latest Jira read now shows no outage
 * or a severity below L2 (spec §2 "Redelivery"): its rows and status are
 * left unchanged, and the channel gets a note so a person decides — a
 * correction that clears every partner is how they'd remove it. No button.
 */
export function jiraDowngradedNote(input: JiraDowngradedNoteInput): SlackMessage {
  const reasonText = input.reason === "no_outage" ? "no outage" : "severity below L2";
  const text = `${input.pirKey}: Jira now shows ${reasonText}. Rows were left unchanged; use Correct to remove the partners if this PIR should not count.`;
  const blocks: SlackBlock[] = [section(`${text}\n${link(input.pirUrl, input.pirKey)}`)];
  return { text, blocks };
}

function section(text: string): SectionBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/**
 * Follows the house style in src/alerts/messages.ts's slackLink(): only
 * wraps the URL as a link when it can't break Slack's `<url|label>` syntax
 * (no `<`, `>`, `|` or whitespace). Otherwise falls back to the escaped
 * label alone. The label is always escaped.
 */
function link(url: string, label: string): string {
  const escapedLabel = escapeMrkdwn(label);
  if (/^https?:\/\//.test(url) && !/[<>|\s]/.test(url)) {
    return `<${url}|${escapedLabel}>`;
  }
  return escapedLabel;
}

/**
 * The field lines for the capture message (spec §3): affected partners,
 * affected service(s), outage minutes, severity and incident start, plus an
 * additional-comment line for the non-pilot count. Outage minutes, severity
 * and incident start are identical across a PIR's rows, so they're read off
 * the first row; with zero rows there's nothing to read, so those three
 * lines are omitted entirely.
 */
function buildFieldsLines(rows: CaptureRow[], nonPilotIdCount: number): string[] {
  const nonPilotLine = formatNonPilotComment(nonPilotIdCount);

  if (rows.length === 0) {
    const lines = ["*Affected Partners:* None attributed", "*Affected Service(s):* —"];
    if (nonPilotLine) {
      lines.push(nonPilotLine);
    }
    return lines;
  }

  const partners = distinct(
    rows.map((row) => `${escapeMrkdwn(row.partner)} (${row.partnerId ? escapeMrkdwn(row.partnerId) : "—"})`),
  );
  const services = distinct(rows.map((row) => escapeMrkdwn(row.affectedService)));
  const first = rows[0];

  const lines = [
    `*Affected Partners:* ${partners.join(", ")}`,
    `*Affected Service(s):* ${services.join(", ")}`,
    `*Outage Minutes:* ${first.outageMinutes}`,
    `*Severity:* ${escapeMrkdwn(first.severity)}`,
    `*Incident Started:* ${formatUtc(first.incidentStarted)}`,
  ];
  if (nonPilotLine) {
    lines.push(nonPilotLine);
  }
  return lines;
}

/** Distinct values, first-occurrence order preserved. */
function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function formatNonPilotComment(nonPilotIdCount: number): string | null {
  if (nonPilotIdCount === 0) {
    return null;
  }
  const noun = nonPilotIdCount === 1 ? "1 non-pilot merchant ID ignored." : `${nonPilotIdCount} non-pilot merchant ID(s) ignored.`;
  return `*Additional Comment:* ${noun}`;
}

/**
 * The unresolved warning line for the capture message (spec §3): a single,
 * prominent line placed above the field lines, listing every unresolved
 * value. An unresolved raw can be a whole prose paragraph (a free-text
 * merchants field with no partner match and no digit run), so each is
 * truncated for display to keep the section well under Slack's 3000-char
 * limit.
 */
function formatUnresolvedLine(items: UnresolvedValue[]): string {
  const rendered = items.map(formatUnresolvedItem).join("; ");
  return `:warning: *Unresolved (no rows until corrected):* ${rendered}`;
}

function formatUnresolvedItem(item: UnresolvedValue): string {
  const label = item.kind === "service_ari" ? "service" : "merchant";
  const display = item.kind === "service_ari" ? ariTrailingSegment(item.raw) : item.raw;
  const truncated = display.length > UNRESOLVED_RAW_MAX;
  const shown = truncated ? display.slice(0, UNRESOLVED_RAW_MAX) : display;
  return `${label} "${escapeMrkdwn(shown)}${truncated ? "…" : ""}"`;
}

/** The trailing UUID after the last "/", or the whole ARI if there is none. */
function ariTrailingSegment(raw: string): string {
  const index = raw.lastIndexOf("/");
  return index === -1 ? raw : raw.slice(index + 1);
}

function formatUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  return `${y}-${m}-${d} ${h}:${min} UTC`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Escapes Slack mrkdwn control characters in interpolated free text. */
function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
