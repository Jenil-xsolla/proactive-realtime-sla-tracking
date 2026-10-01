import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, loadOutages, readContractTerms } from "@/data";
import {
  DATA_COVERAGE_START,
  evaluate,
  HIGH_CONSUMPTION,
  MIN_CONSUMPTION,
  MIN_ELAPSED,
  type PartnerScopes,
  type StatusReason,
  type UsableOutage,
  type Window,
} from "@/engine";
import { PARTNERS, type PartnerId, type ServiceId } from "@/registry";
import { DbTermsProvider, type SlaScope } from "@/terms";

/**
 * Historical replay of evaluate(). asOf steps one UTC day at a time from the
 * first day outage data exists. The result is how often each status rule
 * fired, per partner, per month.
 *
 * Pass `partner` to replay one registry slug. The dashboard backtest button
 * calls this with that filter.
 *
 * This module imports the engine directly. It does not import the alerting
 * module or a Slack client, so running it cannot send an alert.
 */

export type RuleCounts = {
  breaching: number;
  trend: number;
  level: number;
  meeting: number;
};

export type BacktestScopeMonth = {
  scopeId: string;
  /** Days in the month on which this scope was scored. */
  steps: number;
  rules: RuleCounts;
};

export type BacktestMonth = {
  month: string;
  /** UTC days replayed in this month, including days before the scope was in force. */
  days: number;
  /** False when no contract-bound scope covered any replayed day. Rule counts are absent. */
  exposure: boolean;
  scopes: BacktestScopeMonth[];
};

export type BacktestPartner = {
  partner: string;
  months: BacktestMonth[];
};

export type BacktestReport = {
  range: {
    description: "as far back as data exists";
    from: string;
    through: string;
  };
  constants: {
    MIN_ELAPSED: number;
    MIN_CONSUMPTION: number;
    HIGH_CONSUMPTION: number;
  };
  /** Registry slug when the replay was filtered. Null when every supplied partner was included. */
  partner: string | null;
  partners: BacktestPartner[];
};

type ReplayStep = {
  dayStart: Date;
  asOf: Date;
  month: string;
  window: Window;
};

type ScopeTally = {
  scopeId: string;
  steps: number;
  rules: RuleCounts;
};

type MonthTally = {
  month: string;
  days: number;
  scopes: Map<string, ScopeTally>;
};

export function backtest(input: {
  outages: readonly UsableOutage<PartnerId, ServiceId>[];
  scopes: readonly PartnerScopes<PartnerId, ServiceId>[];
  /** Registry slug. Omit to replay every partner present in `scopes` or `outages`. */
  partner?: string;
  /** Last instant to replay. The UTC day containing this instant is included when it is after that day's start. */
  through: Date;
}): BacktestReport {
  if (Number.isNaN(input.through.getTime())) {
    throw new Error("through must be a valid instant.");
  }

  const partnerIds = selectedPartners(input.partner, input.scopes, input.outages);
  const partnerSet = new Set(partnerIds);
  const scopes = input.scopes.filter((entry) => partnerSet.has(entry.partner));
  const outages = input.outages.filter((row) => partnerSet.has(row.partnerId));
  const steps = replaySteps(input.through);
  const byPartner = new Map<string, Map<string, MonthTally>>();
  for (const partnerId of partnerIds) {
    byPartner.set(partnerId, new Map());
  }

  for (const step of steps) {
    const results = evaluate({
      outages,
      scopes,
      window: step.window,
      asOf: step.asOf,
    });
    for (const partnerId of partnerIds) {
      const months = byPartner.get(partnerId);
      if (months === undefined) {
        continue;
      }
      let month = months.get(step.month);
      if (month === undefined) {
        month = { month: step.month, days: 0, scopes: new Map() };
        months.set(step.month, month);
      }
      month.days += 1;
      for (const result of results) {
        if (result.kind !== "scored" || result.partner !== partnerId) {
          continue;
        }
        let scope = month.scopes.get(result.scopeId);
        if (scope === undefined) {
          scope = { scopeId: result.scopeId, steps: 0, rules: emptyRules() };
          month.scopes.set(result.scopeId, scope);
        }
        scope.steps += 1;
        addRules(scope.rules, result.reason);
      }
    }
  }

  const lastStep = steps[steps.length - 1];
  return {
    range: {
      description: "as far back as data exists",
      from: DATA_COVERAGE_START,
      through: lastStep === undefined ? DATA_COVERAGE_START : formatUtcDate(lastStep.dayStart),
    },
    constants: {
      MIN_ELAPSED,
      MIN_CONSUMPTION,
      HIGH_CONSUMPTION,
    },
    partner: input.partner ?? null,
    partners: partnerIds.map((partnerId) => ({
      partner: partnerId,
      months: [...(byPartner.get(partnerId)?.values() ?? [])].map((month) => ({
        month: month.month,
        days: month.days,
        exposure: month.scopes.size > 0,
        scopes: [...month.scopes.values()].map((scope) => ({
          scopeId: scope.scopeId,
          steps: scope.steps,
          rules: scope.rules,
        })),
      })),
    })),
  };
}

export function formatBacktestTable(report: BacktestReport): string {
  const rows: string[][] = [];
  const totals = emptyRules();
  for (const partner of report.partners) {
    for (const month of partner.months) {
      if (!month.exposure) {
        rows.push([partner.partner, month.month, "no exposure", "-", "-", "-", "-", "-"]);
        continue;
      }
      for (const scope of month.scopes) {
        rows.push([
          partner.partner,
          month.month,
          scope.scopeId,
          String(scope.steps),
          String(scope.rules.breaching),
          String(scope.rules.trend),
          String(scope.rules.level),
          String(scope.rules.meeting),
        ]);
        totals.breaching += scope.rules.breaching;
        totals.trend += scope.rules.trend;
        totals.level += scope.rules.level;
        totals.meeting += scope.rules.meeting;
      }
    }
  }

  const lines = [
    report.range.description,
    `${report.range.from} through ${report.range.through}`,
    "",
    `MIN_ELAPSED       ${report.constants.MIN_ELAPSED}`,
    `MIN_CONSUMPTION   ${report.constants.MIN_CONSUMPTION}`,
    `HIGH_CONSUMPTION  ${report.constants.HIGH_CONSUMPTION}`,
    "",
    table(
      ["partner", "month", "scope", "steps", "breaching", "trend", "level", "meeting"],
      rows,
    ),
    "",
    table(
      ["rule", "count"],
      [
        ["breaching", String(totals.breaching)],
        ["trend", String(totals.trend)],
        ["level", String(totals.level)],
        ["meeting", String(totals.meeting)],
      ],
    ),
    "",
    "Trend and level each count on a step where that clause fired. Breaching and meeting each count alone.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function serializeBacktest(report: BacktestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function writeBacktestFile(report: BacktestReport, filePath: string): void {
  writeFileSync(filePath, serializeBacktest(report));
}

function selectedPartners(
  partner: string | undefined,
  scopes: readonly PartnerScopes<PartnerId, ServiceId>[],
  outages: readonly UsableOutage<PartnerId, ServiceId>[],
): string[] {
  if (partner !== undefined) {
    if (!PARTNERS.some((entry) => entry.id === partner)) {
      throw new Error(`Unknown partner "${partner}".`);
    }
    return [partner];
  }

  const present = new Set<string>();
  for (const entry of scopes) {
    present.add(entry.partner);
  }
  for (const row of outages) {
    present.add(row.partnerId);
  }

  const ordered: string[] = PARTNERS.map((entry) => entry.id).filter((id) => present.has(id));
  for (const id of present) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

function replaySteps(through: Date): ReplayStep[] {
  const startMs = Date.parse(`${DATA_COVERAGE_START}T00:00:00.000Z`);
  const endMs = through.getTime();
  const steps: ReplayStep[] = [];
  for (let cursor = startMs; cursor < endMs; ) {
    const dayStart = new Date(cursor);
    const year = dayStart.getUTCFullYear();
    const monthIndex = dayStart.getUTCMonth();
    const nextMs = Date.UTC(year, monthIndex, dayStart.getUTCDate() + 1);
    const monthEndMs = Date.UTC(year, monthIndex + 1, 1);
    steps.push({
      dayStart,
      asOf: new Date(Math.min(nextMs, monthEndMs, endMs)),
      month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      window: {
        // Calendar month. evaluate() starts each scope at the later of this
        // start, effectiveFrom, and 2026-01-01, and prorates that shorter window.
        start: new Date(Date.UTC(year, monthIndex, 1)),
        end: new Date(monthEndMs),
      },
    });
    cursor = nextMs;
  }
  return steps;
}

function emptyRules(): RuleCounts {
  return { breaching: 0, trend: 0, level: 0, meeting: 0 };
}

function addRules(rules: RuleCounts, reason: StatusReason): void {
  if (reason.rule === "breaching") {
    rules.breaching += 1;
    return;
  }
  if (reason.rule === "meeting") {
    rules.meeting += 1;
    return;
  }
  for (const name of reason.fired) {
    rules[name] += 1;
  }
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  if (rows.length === 0) {
    return `${format(headers)}\n  (none)`;
  }
  return [format(headers), ...rows.map(format)].join("\n");
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  if (!existsSync(".env")) {
    throw new Error("DATABASE_URL is required");
  }
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1 || trimmed.slice(0, separator).trim() !== "DATABASE_URL") {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error("DATABASE_URL is required");
}

function parseArgs(argv: readonly string[]): { partner?: string; out: string } {
  let partner: string | undefined;
  let out = "backtest.json";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--partner") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--partner requires a registry slug.");
      }
      partner = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--partner=")) {
      partner = argument.slice("--partner=".length);
      if (partner === "") {
        throw new Error("--partner requires a registry slug.");
      }
      continue;
    }
    if (argument === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--out requires a file path.");
      }
      out = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--out=")) {
      out = argument.slice("--out=".length);
      if (out === "") {
        throw new Error("--out requires a file path.");
      }
      continue;
    }
    throw new Error(`Unknown argument "${argument ?? ""}".`);
  }
  return { partner, out };
}

async function scopesSeenInReplay(
  terms: { listScopes(partner: PartnerId, asOf: Date): Promise<SlaScope[]> },
  through: Date,
  partner: string | undefined,
): Promise<PartnerScopes<PartnerId, ServiceId>[]> {
  const selected =
    partner === undefined ? [...PARTNERS] : PARTNERS.filter((entry) => entry.id === partner);
  const found = new Map<PartnerId, Map<string, SlaScope>>();
  for (const entry of selected) {
    found.set(entry.id, new Map());
  }
  for (const step of replaySteps(through)) {
    for (const entry of selected) {
      const scopes = await terms.listScopes(entry.id, step.asOf);
      const bucket = found.get(entry.id);
      if (bucket === undefined) {
        continue;
      }
      for (const scope of scopes) {
        bucket.set(scope.scopeId, scope);
      }
    }
  }
  return selected.map((entry) => ({
    partner: entry.id,
    scopes: [...(found.get(entry.id)?.values() ?? [])],
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.partner !== undefined && !PARTNERS.some((entry) => entry.id === args.partner)) {
    throw new Error(`Unknown partner "${args.partner}".`);
  }
  const connectionString = process.env.DATABASE_URL ?? databaseUrl();
  const through = new Date();
  const database = createDatabase(connectionString);
  try {
    const partition = await loadOutages(database);
    const scopes = await scopesSeenInReplay(
      new DbTermsProvider(() => readContractTerms(database)),
      through,
      args.partner,
    );
    const report = backtest({
      outages: partition.usable,
      scopes,
      partner: args.partner,
      through,
    });
    process.stdout.write(formatBacktestTable(report));
    writeBacktestFile(report, args.out);
    process.stdout.write(`${resolve(args.out)}\n`);
  } finally {
    await database.$client.end();
  }
}

const entry = process.argv[1];
const invokedDirectly =
  entry !== undefined &&
  (basename(entry) === "backtest.ts" || import.meta.url === pathToFileURL(entry).href);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Backtest failed");
    process.exitCode = 1;
  });
}
