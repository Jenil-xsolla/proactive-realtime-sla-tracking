import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDatabase,
  readContractTerms,
  saveContractTerms,
  type ContractTermsBody,
  type Database,
} from "@/data";
import { PARTNERS, type PartnerId } from "@/registry";
import { loadContractFile } from "@/terms/load-contract";
import type { ContractFile, ContractScope } from "@/terms";

/** Local file. Gitignored. Never commit its contents. */
export const CONTRACT_TERMS_FILE = ".local/contract-terms.json";

const UPDATED_BY = "seed";

export type SeedOutcome = {
  partner: string;
  action: "saved" | "skipped";
  version: number;
};

/** Schema-owner connection, the same variable pnpm db:migrate and db:import-backfill use. */
export function getSeedDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.MIGRATION_DATABASE_URL?.trim() || (env === process.env ? migrationUrlFromDotEnv() : undefined);
  if (!url) {
    throw new Error("MIGRATION_DATABASE_URL is required");
  }
  return url;
}

export function parseSeedArgs(argv: readonly string[]): { force: boolean } {
  let force = false;
  for (const argument of argv) {
    if (argument === "--force") {
      force = true;
      continue;
    }
    throw new Error(`Unknown argument "${argument}".`);
  }
  return { force };
}

/**
 * Validates every entry with loadContractFile, then saves each as
 * contract_bound through saveContractTerms. An existing row is left in
 * place unless force is set. Warnings are reported and do not block the save.
 * Nothing is written until every entry has validated.
 */
export async function seedContractTermsFile(
  db: Database,
  filePath: string,
  options: { force: boolean; write?: (line: string) => void },
): Promise<SeedOutcome[]> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const prepared = prepareEntries(readEntries(filePath));
  const existing = new Map((await readContractTerms(db)).map((row) => [row.partnerSlug, row.version]));
  const outcomes: SeedOutcome[] = [];

  for (const entry of prepared) {
    for (const warning of entry.warnings) {
      write(`Warning for ${entry.partner}: ${warning}`);
    }
    const current = existing.get(entry.partner);
    if (current !== undefined && !options.force) {
      write(`Skipped ${entry.partner}: a row already exists at version ${current}.`);
      outcomes.push({ partner: entry.partner, action: "skipped", version: current });
      continue;
    }
    const saved = await saveContractTerms(
      db,
      entry.partner,
      entry.body,
      "contract_bound",
      UPDATED_BY,
      current ?? null,
    );
    if (saved.kind === "conflict") {
      throw new Error(`Could not save ${entry.partner}: the row changed while seeding.`);
    }
    write(`Saved ${entry.partner} at version ${saved.version}.`);
    outcomes.push({ partner: entry.partner, action: "saved", version: saved.version });
  }

  return outcomes;
}

type PreparedEntry = {
  partner: PartnerId;
  body: ContractTermsBody;
  warnings: string[];
};

function prepareEntries(entries: readonly { partner: string; body: ContractTermsBody }[]): PreparedEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (seen.has(entry.partner)) {
      throw new Error(`Partner "${entry.partner}" appears more than once.`);
    }
    seen.add(entry.partner);
    const partner = partnerId(entry.partner);
    const file: ContractFile = { partner, lifecycle: "contract_bound", ...entry.body };
    const loaded = loadContractFile(file);
    return { partner, body: entry.body, warnings: loaded.warnings };
  });
}

function readEntries(filePath: string): { partner: string; body: ContractTermsBody }[] {
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
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON array.`);
  }
  return parsed.map((entry, index) => parseEntry(entry, index));
}

function parseEntry(entry: unknown, index: number): { partner: string; body: ContractTermsBody } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`Entry ${index + 1} is not an object.`);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.partner !== "string" || record.partner.trim() === "") {
    throw new Error(`Entry ${index + 1} is missing partner.`);
  }
  return {
    partner: record.partner,
    body: {
      effectiveFrom: record.effectiveFrom as ContractTermsBody["effectiveFrom"],
      effectiveTo: record.effectiveTo as ContractTermsBody["effectiveTo"],
      scopes: record.scopes as ContractScope[],
      contractAggregateCap: record.contractAggregateCap as ContractTermsBody["contractAggregateCap"],
    },
  };
}

function partnerId(value: string): PartnerId {
  const found = PARTNERS.find((partner) => partner.id === value);
  if (found === undefined) {
    throw new Error(`Unknown partner "${value}".`);
  }
  return found.id;
}

function migrationUrlFromDotEnv(): string | undefined {
  if (!existsSync(".env")) {
    return undefined;
  }
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1 || trimmed.slice(0, separator).trim() !== "MIGRATION_DATABASE_URL") {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  const { force } = parseSeedArgs(process.argv.slice(2));
  const database = createDatabase(getSeedDatabaseUrl());
  try {
    await seedContractTermsFile(database, resolve(process.cwd(), CONTRACT_TERMS_FILE), { force });
  } finally {
    await database.$client.end();
  }
}

const entry = process.argv[1];
const invokedDirectly =
  entry !== undefined &&
  (basename(entry) === "seed-contract-terms.ts" || import.meta.url === pathToFileURL(entry).href);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  });
}
