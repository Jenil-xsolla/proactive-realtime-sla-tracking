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

export type CaptureMessageInput = {
  pirKey: string;
  pirUrl: string;
  rows: CaptureRow[];
  unresolved: UnresolvedValue[];
  nonPilotIdCount: number;
  lastCorrection?: LastCorrection;
};

/** Builds the capture-message posted to the engineering channel (spec §3). */
export function captureMessage(input: CaptureMessageInput): SlackMessage {
  const { pirKey, pirUrl, rows, unresolved, nonPilotIdCount, lastCorrection } = input;
  const headerLine = `${pirKey} captured. It will appear on the dashboard.`;

  const blocks: SlackBlock[] = [section(`${headerLine}\n${link(pirUrl, pirKey)}`)];

  if (unresolved.length > 0) {
    const lines = [
      ":warning: *Unresolved — these produce no rows until corrected*",
      ...unresolved.map(formatUnresolved),
    ];
    blocks.push(section(lines.join("\n")));
  }

  const rowLines = rows.length === 0 ? ["No pilot partner was attributed to this PIR."] : rows.map(formatRow);
  if (nonPilotIdCount > 0) {
    rowLines.push(`${nonPilotIdCount} non-pilot merchant ID(s) ignored.`);
  }
  blocks.push(section(rowLines.join("\n")));

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Correct" },
        action_id: "correct",
        value: pirKey,
      },
    ],
  });

  if (lastCorrection) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Last corrected by ${escapeMrkdwn(lastCorrection.by)} at ${formatUtc(lastCorrection.at)}`,
        },
      ],
    });
  }

  return { text: headerLine, blocks };
}

export type FailureNoticeInput = { pirKey: string; pirUrl: string; error: string };

/** Short notice for a PIR that failed to capture (spec §4 failure table). No button. */
export function failureNotice(input: FailureNoticeInput): SlackMessage {
  const text = `${input.pirKey} failed to capture.`;
  const blocks: SlackBlock[] = [
    section(`${text}\n${link(input.pirUrl, input.pirKey)}\n${escapeMrkdwn(input.error)}`),
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

function section(text: string): SectionBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function link(url: string, label: string): string {
  return `<${url}|${label}>`;
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

function formatUnresolved(item: UnresolvedValue): string {
  if (item.kind === "service_ari") {
    return `• service: ${escapeMrkdwn(ariTrailingSegment(item.raw))}`;
  }
  return `• merchant: ${escapeMrkdwn(item.raw)}`;
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
