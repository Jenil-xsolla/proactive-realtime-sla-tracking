import { resolveSeverity } from "@/registry";

/**
 * Pure extraction of the fields ingestion needs from a Jira PIR issue and its
 * linked incident. No network calls, no database access, no partner/service
 * resolution — that happens in later stages of the pipeline.
 */

export type PirReadValue = {
  pirKey: string;
  pirUrl: string;
  /** Jira option text, e.g. "L1 — Critical". */
  severity: string;
  outageMinutes: number;
  serviceAris: string[];
  merchantText: string | null;
  incidentKey: string;
};

export type PirRead =
  | { kind: "skip"; reason: "no_outage" | "below_l2"; severity?: string }
  | { kind: "invalid"; problems: string[] }
  | { kind: "ok"; value: PirReadValue };

const INCIDENT_LINK_TYPE_ID = "11031";

/** ADF node types that mark the end of a block and so contribute a newline. */
const ADF_BLOCK_TYPES = new Set([
  "paragraph",
  "listItem",
  "heading",
  "blockquote",
  "codeBlock",
  "panel",
  "tableCell",
  "tableHeader",
  "taskItem",
  "decisionItem",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

type MinutesResult =
  | { kind: "skip" }
  | { kind: "invalid"; problem: string }
  | { kind: "ok"; minutes: number };

function readOutageMinutes(fields: Record<string, unknown> | null): MinutesResult {
  const raw = fields?.customfield_31331;

  if (raw === null || raw === undefined) {
    return { kind: "skip" };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return { kind: "invalid", problem: `invalid outage minutes: ${String(raw)}` };
    }
    if (raw === 0) {
      return { kind: "skip" };
    }
    if (raw < 0) {
      return { kind: "invalid", problem: `invalid outage minutes: ${raw}` };
    }
    return { kind: "ok", minutes: raw };
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { kind: "invalid", problem: `invalid outage minutes: ${JSON.stringify(raw)}` };
    }
    const parsed = Number(trimmed);
    if (parsed === 0) {
      return { kind: "skip" };
    }
    if (parsed < 0) {
      return { kind: "invalid", problem: `invalid outage minutes: ${JSON.stringify(raw)}` };
    }
    return { kind: "ok", minutes: parsed };
  }

  return { kind: "invalid", problem: `invalid outage minutes: ${JSON.stringify(raw)}` };
}

type SeverityResult =
  | { kind: "invalid"; problem: string }
  | { kind: "skip"; severity: string }
  | { kind: "ok"; severity: string };

function readSeverity(fields: Record<string, unknown> | null): SeverityResult {
  const raw = asRecord(fields?.customfield_11646);
  const label = raw && typeof raw.value === "string" ? raw.value : null;

  if (label === null) {
    return { kind: "invalid", problem: "missing severity" };
  }

  const resolved = resolveSeverity(label);
  if (resolved.status === "resolved") {
    return { kind: "ok", severity: label };
  }

  if (/^l[34]\b/i.test(label.trim())) {
    return { kind: "skip", severity: label };
  }

  return { kind: "invalid", problem: `unrecognised severity: ${label}` };
}

function readIncidentKey(fields: Record<string, unknown> | null): string | null {
  const links = fields?.issuelinks;
  if (!Array.isArray(links)) {
    return null;
  }

  for (const link of links) {
    const linkRecord = asRecord(link);
    if (!linkRecord) {
      continue;
    }
    const type = asRecord(linkRecord.type);
    if (!type || type.id !== INCIDENT_LINK_TYPE_ID) {
      continue;
    }
    const outward = asRecord(linkRecord.outwardIssue);
    if (outward && typeof outward.key === "string") {
      return outward.key;
    }
    const inward = asRecord(linkRecord.inwardIssue);
    if (inward && typeof inward.key === "string") {
      return inward.key;
    }
  }

  return null;
}

function readServiceAris(fields: Record<string, unknown> | null): string[] | null {
  const raw = fields?.customfield_10399;
  if (!Array.isArray(raw)) {
    return null;
  }

  const aris: string[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (record && typeof record.id === "string") {
      aris.push(record.id);
    }
  }

  return aris.length === 0 ? null : aris;
}

function walkAdf(node: unknown, out: string[]): void {
  const record = asRecord(node);
  if (!record) {
    return;
  }

  const type = typeof record.type === "string" ? record.type : undefined;

  if (type === "text" && typeof record.text === "string") {
    out.push(record.text);
    return;
  }

  if (type === "inlineCard" || type === "blockCard") {
    const attrs = asRecord(record.attrs);
    const url = attrs?.url;
    if (typeof url === "string") {
      out.push(url);
    }
    return;
  }

  if (type === "hardBreak") {
    out.push("\n");
    return;
  }

  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      walkAdf(child, out);
    }
  }

  if (type !== undefined && ADF_BLOCK_TYPES.has(type)) {
    out.push("\n");
  }
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{2,}/g, "\n").trim();
}

function readMerchantText(fields: Record<string, unknown> | null): string | null {
  const raw = fields?.customfield_13920;

  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw === "string") {
    // Not parsed as ADF, but normalised the same way flattened ADF text is:
    // trim and collapse blank lines.
    const collapsed = collapseBlankLines(raw);
    return collapsed.length === 0 ? null : collapsed;
  }

  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const out: string[] = [];
  walkAdf(record, out);
  const collapsed = collapseBlankLines(out.join(""));
  return collapsed.length === 0 ? null : collapsed;
}

function buildPirUrl(baseUrl: string, pirKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/browse/${pirKey}`;
}

/**
 * Reads the fields ingestion needs off a raw Jira PIR issue payload. Never
 * throws: a malformed payload comes back as `invalid` with problem strings.
 */
export function readPir(pir: unknown, baseUrl: string): PirRead {
  const pirRecord = asRecord(pir);
  const fields = pirRecord ? asRecord(pirRecord.fields) : null;

  const problems: string[] = [];

  const minutesResult = readOutageMinutes(fields);
  if (minutesResult.kind === "skip") {
    return { kind: "skip", reason: "no_outage" };
  }
  let outageMinutes = 0;
  if (minutesResult.kind === "invalid") {
    problems.push(minutesResult.problem);
  } else {
    outageMinutes = minutesResult.minutes;
  }

  const severityResult = readSeverity(fields);
  if (severityResult.kind === "skip") {
    return { kind: "skip", reason: "below_l2", severity: severityResult.severity };
  }
  let severity = "";
  if (severityResult.kind === "invalid") {
    problems.push(severityResult.problem);
  } else {
    severity = severityResult.severity;
  }

  const incidentKey = readIncidentKey(fields);
  if (incidentKey === null) {
    problems.push("missing incident link");
  }

  const serviceAris = readServiceAris(fields);
  if (serviceAris === null) {
    problems.push("no affected services");
  }

  if (problems.length > 0) {
    return { kind: "invalid", problems };
  }

  const pirKey = typeof pirRecord?.key === "string" ? pirRecord.key : null;
  if (pirKey === null) {
    return { kind: "invalid", problems: ["missing pir key"] };
  }

  return {
    kind: "ok",
    value: {
      pirKey,
      pirUrl: buildPirUrl(baseUrl, pirKey),
      severity,
      outageMinutes,
      // Non-null: an empty problems array above means incidentKey and
      // serviceAris both passed their null checks.
      serviceAris: serviceAris as string[],
      merchantText: readMerchantText(fields),
      incidentKey: incidentKey as string,
    },
  };
}

/**
 * Reads the incident's actual start time. Never falls back to the incident's
 * `created` timestamp, which is a different, later moment.
 */
export function readIncidentStart(incident: unknown): Date | null {
  const record = asRecord(incident);
  const fields = record ? asRecord(record.fields) : null;
  const raw = fields?.customfield_10068;

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}
