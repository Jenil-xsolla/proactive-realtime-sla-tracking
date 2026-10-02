import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inArray } from "drizzle-orm";
import { createDatabase, parseMerchantId, slaOutages, type Database } from "@/data";
import { PARTNERS, SERVICES, resolvePartner, resolveService } from "@/registry";

/**
 * Historical outage import. The file is gitignored. Never commit its contents.
 *
 * Connects with INGESTION_DATABASE_URL, the same variable sla-ingestion uses,
 * so the session is ingestion_writer. app_user cannot write sla_outages.
 *
 * Every row is validated before any write. One failing row aborts the import
 * and lists every problem. The insert is one transaction with
 * ON CONFLICT (pir_key, partner, affected_service) DO NOTHING, so a row
 * already present — including one the pipeline wrote — is left as it is.
 */
export const BACKFILL_FILE = ".local/backfill-outages.json";

const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|\+00:00)$/;

export class ImportBackfillError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(["Import aborted. No rows written.", ...problems].join("\n"));
    this.name = "ImportBackfillError";
    this.problems = problems;
  }
}

export type SkippedBackfillRow = {
  pirKey: string;
  partner: string;
  affectedService: string;
  source: "pipeline" | "backfill";
};

export type ImportBackfillResult = {
  inserted: number;
  skipped: SkippedBackfillRow[];
  /** True when any skipped row was written by the pipeline. */
  pipelineSkipped: boolean;
};

type ValidRow = {
  pirKey: string;
  partner: string;
  partnerId: string | null;
  incidentStarted: Date;
  affectedService: string;
  outageMinutes: number;
  severity: string | null;
  pirUrl: string | null;
};

export function getImportDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.INGESTION_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("INGESTION_DATABASE_URL is required");
  }
  return url;
}

export function parseImportArgs(argv: readonly string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const argument of argv) {
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument "${argument}".`);
  }
  return { dryRun };
}

/**
 * Validates every row, then inserts with ON CONFLICT DO NOTHING.
 * Nothing is written when any row fails validation, or when dryRun is set.
 */
export async function importBackfillFile(
  db: Database,
  filePath: string,
  options: { dryRun: boolean; write?: (line: string) => void },
): Promise<ImportBackfillResult> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const rows = prepareRows(readRows(filePath));

  return db.transaction(async (tx) => {
    const existing = await loadExisting(tx, rows);
    if (!options.dryRun && rows.length > 0) {
      const inserted = await tx
        .insert(slaOutages)
        .values(
          rows.map((row) => ({
            pirKey: row.pirKey,
            partner: row.partner,
            partnerId: row.partnerId,
            incidentStarted: row.incidentStarted,
            affectedService: row.affectedService,
            outageMinutes: String(row.outageMinutes),
            severity: row.severity,
            pirUrl: row.pirUrl,
            source: "backfill",
            decisionType: null,
            reviewedBy: null,
            reviewedAt: null,
            reason: null,
          })),
        )
        .onConflictDoNothing({
          target: [slaOutages.pirKey, slaOutages.partner, slaOutages.affectedService],
        })
        .returning({
          pirKey: slaOutages.pirKey,
          partner: slaOutages.partner,
          affectedService: slaOutages.affectedService,
        });
      if (inserted.length !== rows.filter((row) => !existing.has(rowKey(row))).length) {
        throw new Error("Insert count did not match the rows that were absent. Nothing was written.");
      }
    }

    const result = classify(rows, existing);
    report(result, options.dryRun, write);
    return result;
  });
}

function report(result: ImportBackfillResult, dryRun: boolean, write: (line: string) => void): void {
  if (dryRun) {
    write("Dry run: no rows written.");
    write(`Would insert ${result.inserted}.`);
  } else {
    write(`Inserted ${result.inserted}.`);
  }

  const skipVerb = dryRun ? "Would skip" : "Skipped";
  if (result.skipped.length === 0) {
    write(`${skipVerb} 0 already present.`);
  } else {
    write(`${skipVerb} ${result.skipped.length} already present:`);
    for (const row of result.skipped) {
      write(`${row.pirKey} | ${row.partner} | ${row.affectedService} | ${row.source}`);
    }
  }

  write(
    result.pipelineSkipped
      ? "A skipped row came from the pipeline."
      : "No skipped row came from the pipeline.",
  );
}

function classify(
  rows: readonly ValidRow[],
  existing: ReadonlyMap<string, "pipeline" | "backfill">,
): ImportBackfillResult {
  const skipped = rows.flatMap((row) => {
    const source = existing.get(rowKey(row));
    if (source === undefined) {
      return [];
    }
    return [
      {
        pirKey: row.pirKey,
        partner: row.partner,
        affectedService: row.affectedService,
        source,
      },
    ];
  });
  return {
    inserted: rows.length - skipped.length,
    skipped,
    pipelineSkipped: skipped.some((row) => row.source === "pipeline"),
  };
}

async function loadExisting(
  db: Database,
  rows: readonly ValidRow[],
): Promise<Map<string, "pipeline" | "backfill">> {
  const pirKeys = [...new Set(rows.map((row) => row.pirKey))];
  const found = new Map<string, "pipeline" | "backfill">();
  if (pirKeys.length === 0) {
    return found;
  }

  const existing = await db
    .select({
      pirKey: slaOutages.pirKey,
      partner: slaOutages.partner,
      affectedService: slaOutages.affectedService,
      source: slaOutages.source,
    })
    .from(slaOutages)
    .where(inArray(slaOutages.pirKey, pirKeys));

  for (const row of existing) {
    if (row.source !== "pipeline" && row.source !== "backfill") {
      throw new Error(`Unexpected sla_outages.source "${row.source}".`);
    }
    found.set(rowKey(row), row.source);
  }
  return found;
}

function rowKey(row: { pirKey: string; partner: string; affectedService: string }): string {
  return `${row.pirKey}\u0000${row.partner}\u0000${row.affectedService}`;
}

function prepareRows(rawRows: readonly unknown[]): ValidRow[] {
  const problems: string[] = [];
  const rows: ValidRow[] = [];
  const seen = new Map<string, number>();

  for (const [index, entry] of rawRows.entries()) {
    const row = validateRow(entry, index, problems);
    const duplicate = noteConflict(entry, index, seen, problems);
    if (row !== undefined && !duplicate) {
      rows.push(row);
    }
  }

  if (problems.length > 0) {
    throw new ImportBackfillError(problems);
  }
  return rows;
}

function noteConflict(
  entry: unknown,
  index: number,
  seen: Map<string, number>,
  problems: string[],
): boolean {
  if (!isRecord(entry)) {
    return false;
  }
  const pirKey = entry.pir_key;
  const partner = entry.partner;
  const affectedService = entry.affected_service;
  if (typeof pirKey !== "string" || pirKey.trim() === "") {
    return false;
  }
  if (typeof partner !== "string" || partner.trim() === "") {
    return false;
  }
  if (typeof affectedService !== "string" || affectedService.trim() === "") {
    return false;
  }
  const key = `${pirKey}\u0000${partner}\u0000${affectedService}`;
  const first = seen.get(key);
  if (first !== undefined) {
    problems.push(`Row ${index + 1}: duplicates row ${first + 1} on (pir_key, partner, affected_service).`);
    return true;
  }
  seen.set(key, index);
  return false;
}

function validateRow(entry: unknown, index: number, problems: string[]): ValidRow | undefined {
  if (!isRecord(entry)) {
    problems.push(`Row ${index + 1}: row must be an object.`);
    return undefined;
  }

  const started = problems.length;
  const pirKey = requireText(entry.pir_key, "pir_key", index, problems);
  requireBackfill(entry.source, index, problems);
  requireNull(entry.decision_type, "decision_type", index, problems);
  requireNull(entry.reviewed_by, "reviewed_by", index, problems);
  requireNull(entry.reviewed_at, "reviewed_at", index, problems);
  requireNull(entry.reason, "reason", index, problems);
  const outageMinutes = requireMinutes(entry.outage_minutes, index, problems);
  const incidentStarted = requireUtc(entry.incident_started, index, problems);
  const partner = requirePartner(entry, index, problems);
  const affectedService = requireService(entry.affected_service, index, problems);
  const severity = optionalText(entry.severity, "severity", index, problems);
  const pirUrl = optionalText(entry.pir_url, "pir_url", index, problems);

  if (
    problems.length !== started ||
    pirKey === undefined ||
    outageMinutes === undefined ||
    incidentStarted === undefined ||
    partner === undefined ||
    affectedService === undefined ||
    severity === undefined ||
    pirUrl === undefined
  ) {
    return undefined;
  }

  return {
    pirKey,
    partner: partner.name,
    partnerId: partner.partnerId,
    incidentStarted,
    affectedService,
    outageMinutes,
    severity,
    pirUrl,
  };
}

function requireText(value: unknown, field: string, index: number, problems: string[]): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`Row ${index + 1}: ${field} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function requireBackfill(value: unknown, index: number, problems: string[]): void {
  if (value !== "backfill") {
    problems.push(`Row ${index + 1}: source must be "backfill".`);
  }
}

function requireNull(value: unknown, field: string, index: number, problems: string[]): void {
  if (value !== null) {
    problems.push(`Row ${index + 1}: ${field} must be null.`);
  }
}

function requireMinutes(value: unknown, index: number, problems: string[]): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    problems.push(`Row ${index + 1}: outage_minutes must be greater than 0.`);
    return undefined;
  }
  return value;
}

function requireUtc(value: unknown, index: number, problems: string[]): Date | undefined {
  if (typeof value !== "string" || !isUtcTimestamp(value)) {
    problems.push(`Row ${index + 1}: incident_started must be a valid UTC timestamp.`);
    return undefined;
  }
  return new Date(value);
}

function isUtcTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function requirePartner(
  entry: Record<string, unknown>,
  index: number,
  problems: string[],
): { name: string; partnerId: string | null } | undefined {
  const label = `Row ${index + 1}`;
  if (typeof entry.partner !== "string" || entry.partner.trim() === "") {
    problems.push(`${label}: partner must be a non-empty string.`);
    return undefined;
  }
  const name = entry.partner;
  const rawId = entry.partner_id;
  if (rawId !== null && rawId !== undefined && typeof rawId !== "string") {
    problems.push(`${label}: partner_id must be a string or null.`);
    return undefined;
  }
  const partnerId = typeof rawId === "string" ? rawId : null;
  const parsed = parseMerchantId(partnerId);
  if (parsed.status === "invalid") {
    problems.push(`${label}: partner_id "${parsed.raw}" is not a valid merchant id.`);
    return undefined;
  }

  const merchantId = parsed.status === "parsed" ? parsed.merchantId : null;
  const resolved = resolvePartner({ merchantId, name });
  if (resolved.status === "unresolved") {
    problems.push(
      merchantId !== null
        ? `${label}: partner_id "${partnerId}" does not resolve through the registry.`
        : `${label}: partner "${name}" does not resolve through the registry.`,
    );
    return undefined;
  }

  const displayName = PARTNERS.find((partner) => partner.id === resolved.id)?.displayName;
  if (displayName !== name) {
    problems.push(`${label}: partner "${name}" does not equal the registry display name "${displayName}".`);
    return undefined;
  }
  return {
    name,
    partnerId: parsed.status === "parsed" && partnerId !== null ? partnerId.trim() : null,
  };
}

function requireService(value: unknown, index: number, problems: string[]): string | undefined {
  const label = `Row ${index + 1}`;
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${label}: affected_service must be a non-empty string.`);
    return undefined;
  }
  const resolved = resolveService(value);
  if (resolved.status === "unresolved") {
    problems.push(`${label}: affected_service "${value}" does not resolve through the registry.`);
    return undefined;
  }
  const displayName = SERVICES.find((service) => service.id === resolved.id)?.displayName;
  if (displayName !== value) {
    problems.push(
      `${label}: affected_service "${value}" does not equal the registry display name "${displayName}".`,
    );
    return undefined;
  }
  return value;
}

/** `undefined` means the field failed validation and a problem was already recorded. */
function optionalText(
  value: unknown,
  field: string,
  index: number,
  problems: string[],
): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    problems.push(`Row ${index + 1}: ${field} must be a string or null.`);
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRows(filePath: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Cannot read ${filePath}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${filePath} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON object with a rows array.`);
  }
  const rows = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error(`${filePath} must contain a rows array.`);
  }
  return rows;
}

async function main(): Promise<void> {
  const { dryRun } = parseImportArgs(process.argv.slice(2));
  const database = createDatabase(getImportDatabaseUrl());
  try {
    await importBackfillFile(database, resolve(process.cwd(), BACKFILL_FILE), { dryRun });
  } finally {
    await database.$client.end();
  }
}

const entry = process.argv[1];
const invokedDirectly =
  entry !== undefined &&
  (basename(entry) === "import-backfill.ts" || import.meta.url === pathToFileURL(entry).href);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Import failed");
    process.exitCode = 1;
  });
}
