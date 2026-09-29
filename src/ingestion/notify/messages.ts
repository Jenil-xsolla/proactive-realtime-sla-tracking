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
/** Slack rejects a message with more than this many blocks. */
const MAX_BLOCKS = 50;
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
 * Builds the capture-message posted to the engineering channel (spec §3).
 * Keeps every block within Slack's limits: each section's text stays at or
 * under 3000 characters, and the whole message stays under 50 blocks. The
 * `text` fallback is kept short (the header line only), since Slack only
 * shows it in places (like notifications) that don't render blocks.
 */
export function captureMessage(input: CaptureMessageInput): SlackMessage {
  const { pirKey, pirUrl, rows, unresolved, nonPilotIdCount, lastCorrection } = input;
  const headerLine = `${pirKey} captured. It will appear on the dashboard.`;

  const headerBlock = section(`${headerLine}\n${link(pirUrl, pirKey)}`);

  const unresolvedBlock =
    unresolved.length > 0
      ? section(
          [
            ":warning: *Unresolved — these produce no rows until corrected*",
            ...unresolved.map(formatUnresolved),
          ].join("\n"),
        )
      : null;

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

  // Reserve the fixed blocks (header, unresolved, actions, footer) out of
  // Slack's 50-block cap, and give the rest to the row sections.
  const reservedBlocks = 1 + (unresolvedBlock ? 1 : 0) + 1 + (footerBlock ? 1 : 0);
  const availableRowBlocks = Math.max(1, MAX_BLOCKS - reservedBlocks);
  const rowSections = buildRowsSections({ rows, nonPilotIdCount, availableBlocks: availableRowBlocks });

  const blocks: SlackBlock[] = [headerBlock];
  if (unresolvedBlock) {
    blocks.push(unresolvedBlock);
  }
  blocks.push(...rowSections);
  blocks.push(actionsBlock);
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
 * Rows section(s) for the capture message (spec §3). A PIR can have many
 * (partner, service) rows — 11 partners × several services can exceed
 * Slack's 3000-char section limit — so the lines are split across as many
 * sections as needed, splitting only between lines (never mid-line). If
 * that would still need more sections than the caller's block budget
 * allows, the row count shown is trimmed and a "…and N more rows" line is
 * added instead.
 */
function buildRowsSections(input: {
  rows: CaptureRow[];
  nonPilotIdCount: number;
  availableBlocks: number;
}): SectionBlock[] {
  const { rows, nonPilotIdCount, availableBlocks } = input;
  const nonPilotLines =
    nonPilotIdCount > 0 ? [`${nonPilotIdCount} non-pilot merchant ID(s) ignored.`] : [];

  if (rows.length === 0) {
    const lines = ["No pilot partner was attributed to this PIR.", ...nonPilotLines];
    return chunkLines(lines, MAX_SECTION_CHARS).map(section);
  }

  for (let shown = rows.length; shown >= 0; shown -= 1) {
    const truncationLine =
      shown < rows.length ? [`…and ${rows.length - shown} more rows (see the dashboard).`] : [];
    const lines = [...rows.slice(0, shown).map(formatRow), ...truncationLine, ...nonPilotLines];
    const chunks = chunkLines(lines, MAX_SECTION_CHARS);
    if (chunks.length <= availableBlocks || shown === 0) {
      return chunks.map(section);
    }
  }

  // Unreachable: the shown === 0 iteration above always returns.
  return [];
}

/**
 * Packs lines into as few chunks as possible, each joined text at most
 * `maxChars`, never splitting a line across two chunks.
 */
function chunkLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const addedLen = line.length + (current.length > 0 ? 1 : 0); // +1 for the joining "\n"
    if (current.length > 0 && currentLen + addedLen > maxChars) {
      chunks.push(current.join("\n"));
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += addedLen;
    }
  }
  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }
  return chunks;
}

function formatRow(row: CaptureRow): string {
  const partnerId = row.partnerId ?? "—";
  return [
    `*${escapeMrkdwn(row.partner)}*`,
    partnerId,
    formatUtc(row.incidentStarted),
    escapeMrkdwn(row.affectedService),
    `${row.outageMinutes} min`,
    escapeMrkdwn(row.severity),
  ].join(" · ");
}

/**
 * An unresolved raw can be a whole prose paragraph (a free-text merchants
 * field with no partner match and no digit run), so it's truncated for
 * display to keep the section well under Slack's 3000-char limit.
 */
function formatUnresolved(item: UnresolvedValue): string {
  const label = item.kind === "service_ari" ? "service" : "merchant";
  const display = item.kind === "service_ari" ? ariTrailingSegment(item.raw) : item.raw;
  const truncated = display.length > UNRESOLVED_RAW_MAX;
  const shown = truncated ? display.slice(0, UNRESOLVED_RAW_MAX) : display;
  return `• ${label}: ${escapeMrkdwn(shown)}${truncated ? "…" : ""}`;
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
