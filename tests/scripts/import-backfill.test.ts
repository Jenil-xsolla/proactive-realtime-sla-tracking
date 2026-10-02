import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { slaOutages } from "@/data";
import {
  BACKFILL_FILE,
  ImportBackfillError,
  getImportDatabaseUrl,
  importBackfillFile,
  parseImportArgs,
} from "../../scripts/import-backfill";
import { createTestDatabase, type TestDatabase } from "../support/database";

/**
 * Illustrative rows only. Not the historical backfill, and not `.local/backfill-outages.json`.
 * Minutes 17 and 23 are chosen so a log line that leaked the real file would fail this test.
 */
type BackfillRow = {
  pir_key: string;
  partner: string;
  partner_id: string | null;
  incident_started: string;
  affected_service: string;
  outage_minutes: number;
  severity: string | null;
  pir_url: string | null;
  source: string;
  decision_type: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reason: string | null;
};

function illustrativeRow(overrides: Partial<BackfillRow> = {}): BackfillRow {
  return {
    pir_key: "ILLUSTRATIVE-1",
    partner: "Scopely",
    partner_id: "151639",
    incident_started: "2026-04-16T16:46:00Z",
    affected_service: "IGS-BB",
    outage_minutes: 17,
    severity: "L2 — Major",
    pir_url: "https://example.invalid/illustrative",
    source: "backfill",
    decision_type: null,
    reviewed_by: null,
    reviewed_at: null,
    reason: null,
    ...overrides,
  };
}

const VALID_ROWS = [
  illustrativeRow(),
  illustrativeRow({
    partner: "Niantic",
    partner_id: "221437",
    affected_service: "Payments",
    outage_minutes: 23,
  }),
  illustrativeRow({
    pir_key: "ILLUSTRATIVE-2",
    partner: "Roblox",
    partner_id: null,
    affected_service: "Login",
    outage_minutes: 11,
  }),
];

function writeBackfill(rows: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sla-backfill-"));
  const file = path.join(dir, "backfill-outages.json");
  writeFileSync(file, JSON.stringify({ description: "illustrative", generated: "2026-10-02", rows }));
  return file;
}

async function asRole<T>(testDb: TestDatabase, role: string, fn: () => Promise<T>): Promise<T> {
  await testDb.client.query(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await testDb.client.query("RESET ROLE");
  }
}

async function readOutages(testDb: TestDatabase) {
  return testDb.db
    .select()
    .from(slaOutages)
    .orderBy(slaOutages.pirKey, slaOutages.partner, slaOutages.affectedService);
}

describe("import backfill", () => {
  let testDb: TestDatabase | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it("reads INGESTION_DATABASE_URL and treats --dry-run as the only flag", () => {
    expect(BACKFILL_FILE).toBe(".local/backfill-outages.json");
    expect(() => getImportDatabaseUrl({})).toThrow(/INGESTION_DATABASE_URL is required/);
    expect(() => getImportDatabaseUrl({ INGESTION_DATABASE_URL: "" })).toThrow(
      /INGESTION_DATABASE_URL is required/,
    );
    expect(() => getImportDatabaseUrl({ INGESTION_DATABASE_URL: "  " })).toThrow(
      /INGESTION_DATABASE_URL is required/,
    );
    expect(getImportDatabaseUrl({ INGESTION_DATABASE_URL: "postgres://ingestion_writer@host/db" })).toBe(
      "postgres://ingestion_writer@host/db",
    );
    expect(parseImportArgs([])).toEqual({ dryRun: false });
    expect(parseImportArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(() => parseImportArgs(["--force"])).toThrow(/--force/);
  });

  it("imports valid rows as backfill with null review fields", async () => {
    testDb = await createTestDatabase();
    const lines: string[] = [];
    const file = writeBackfill(VALID_ROWS);

    const result = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, {
        dryRun: false,
        write: (line) => lines.push(line),
      }),
    );

    expect(result).toEqual({ inserted: 3, skipped: [], pipelineSkipped: false });
    expect(lines.join("\n")).toMatch(/Inserted 3/);
    expect(lines.join("\n")).toMatch(/No skipped row came from the pipeline/);

    const written = await readOutages(testDb);
    expect(written).toHaveLength(3);
    expect(written.map((row) => `${row.pirKey}|${row.partner}`)).toEqual([
      "ILLUSTRATIVE-1|Niantic",
      "ILLUSTRATIVE-1|Scopely",
      "ILLUSTRATIVE-2|Roblox",
    ]);
    for (const row of written) {
      expect(row.source).toBe("backfill");
      expect(row.decisionType).toBeNull();
      expect(row.reviewedBy).toBeNull();
      expect(row.reviewedAt).toBeNull();
      expect(row.reason).toBeNull();
      expect(row.incidentStarted).toEqual(new Date("2026-04-16T16:46:00Z"));
    }
    expect(written[0]).toMatchObject({
      partner: "Niantic",
      partnerId: "221437",
      affectedService: "Payments",
      outageMinutes: "23",
    });
    expect(written[1]).toMatchObject({
      pirKey: "ILLUSTRATIVE-1",
      partner: "Scopely",
      partnerId: "151639",
      affectedService: "IGS-BB",
      outageMinutes: "17",
    });
    expect(written[2]).toMatchObject({
      pirKey: "ILLUSTRATIVE-2",
      partner: "Roblox",
      partnerId: null,
      affectedService: "Login",
      outageMinutes: "11",
    });
  });

  it("a second run inserts nothing", async () => {
    testDb = await createTestDatabase();
    const file = writeBackfill(VALID_ROWS);
    await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, { dryRun: false, write: () => undefined }),
    );
    const lines: string[] = [];

    const result = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, {
        dryRun: false,
        write: (line) => lines.push(line),
      }),
    );

    expect(result.inserted).toBe(0);
    expect(result.pipelineSkipped).toBe(false);
    expect(result.skipped).toEqual([
      { pirKey: "ILLUSTRATIVE-1", partner: "Scopely", affectedService: "IGS-BB", source: "backfill" },
      { pirKey: "ILLUSTRATIVE-1", partner: "Niantic", affectedService: "Payments", source: "backfill" },
      { pirKey: "ILLUSTRATIVE-2", partner: "Roblox", affectedService: "Login", source: "backfill" },
    ]);
    expect(lines.join("\n")).toMatch(/ILLUSTRATIVE-1 \| Scopely \| IGS-BB \| backfill/);
    expect(lines.join("\n")).toMatch(/No skipped row came from the pipeline/);
    expect(await readOutages(testDb)).toHaveLength(3);
  });

  it("one invalid service aborts the whole import", async () => {
    testDb = await createTestDatabase();
    const file = writeBackfill([
      illustrativeRow(),
      illustrativeRow({
        partner: "Niantic",
        partner_id: "221437",
        affected_service: "Not A Service",
      }),
    ]);

    const error = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, { dryRun: false, write: () => undefined }),
    ).then(
      () => {
        throw new Error("expected the import to abort");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ImportBackfillError);
    expect((error as ImportBackfillError).problems).toEqual([
      'Row 2: affected_service "Not A Service" does not resolve through the registry.',
    ]);
    expect(await readOutages(testDb)).toHaveLength(0);
  });

  it("lists every validation problem and writes nothing", async () => {
    testDb = await createTestDatabase();
    const file = writeBackfill([
      illustrativeRow(),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-SERVICE", affected_service: "Not A Service" }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-MINUTES", outage_minutes: 0 }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-PARTNER", partner: "Niantic", partner_id: "151639" }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-ALIAS", affected_service: "Chat Platform" }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-SOURCE", source: "pipeline" }),
      illustrativeRow({
        pir_key: "ILLUSTRATIVE-REVIEW",
        decision_type: "human_corrected",
        reviewed_by: "ada",
        reviewed_at: "2026-05-01T00:00:00Z",
        reason: "fixed",
      }),
      illustrativeRow({
        pir_key: "ILLUSTRATIVE-TIME",
        incident_started: "2026-04-16T12:46:00-04:00",
      }),
      illustrativeRow({ pir_key: "" }),
      illustrativeRow({
        pir_key: "ILLUSTRATIVE-ALIAS-PARTNER",
        partner: "Roblox Corporation",
        partner_id: null,
      }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-UNKNOWN-ID", partner_id: "999999" }),
      illustrativeRow({ pir_key: "ILLUSTRATIVE-BAD-ID", partner_id: "not-a-number" }),
      illustrativeRow(),
    ]);

    const error = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, { dryRun: false, write: () => undefined }),
    ).then(
      () => {
        throw new Error("expected the import to abort");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ImportBackfillError);
    expect((error as ImportBackfillError).problems).toEqual([
      'Row 2: affected_service "Not A Service" does not resolve through the registry.',
      "Row 3: outage_minutes must be greater than 0.",
      'Row 4: partner "Niantic" does not equal the registry display name "Scopely".',
      'Row 5: affected_service "Chat Platform" does not equal the registry display name "ChatPlatform".',
      'Row 6: source must be "backfill".',
      "Row 7: decision_type must be null.",
      "Row 7: reviewed_by must be null.",
      "Row 7: reviewed_at must be null.",
      "Row 7: reason must be null.",
      "Row 8: incident_started must be a valid UTC timestamp.",
      "Row 9: pir_key must be a non-empty string.",
      'Row 10: partner "Roblox Corporation" does not equal the registry display name "Roblox".',
      'Row 11: partner_id "999999" does not resolve through the registry.',
      'Row 12: partner_id "not-a-number" is not a valid merchant id.',
      "Row 13: duplicates row 1 on (pir_key, partner, affected_service).",
    ]);
    expect(await readOutages(testDb)).toHaveLength(0);
  });

  it("leaves an existing pipeline row untouched", async () => {
    testDb = await createTestDatabase();
    const incidentStarted = new Date("2026-01-01T00:00:00.000Z");
    await testDb.db.insert(slaOutages).values({
      pirKey: "ILLUSTRATIVE-1",
      partner: "Scopely",
      partnerId: null,
      incidentStarted,
      affectedService: "IGS-BB",
      outageMinutes: "99",
      severity: "L0 — Catastrophic",
      source: "pipeline",
      decisionType: "system_written",
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
      pirUrl: "https://example.invalid/pipeline",
    });
    const before = await testDb.db.select().from(slaOutages).where(eq(slaOutages.partner, "Scopely"));
    const file = writeBackfill([
      illustrativeRow({ outage_minutes: 17, pir_url: "https://example.invalid/backfill" }),
      illustrativeRow({
        partner: "Niantic",
        partner_id: "221437",
        affected_service: "Payments",
        outage_minutes: 23,
      }),
    ]);
    const lines: string[] = [];

    const result = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, {
        dryRun: false,
        write: (line) => lines.push(line),
      }),
    );

    expect(result.inserted).toBe(1);
    expect(result.pipelineSkipped).toBe(true);
    expect(result.skipped).toEqual([
      { pirKey: "ILLUSTRATIVE-1", partner: "Scopely", affectedService: "IGS-BB", source: "pipeline" },
    ]);
    expect(lines.join("\n")).toMatch(/ILLUSTRATIVE-1 \| Scopely \| IGS-BB \| pipeline/);
    expect(lines.join("\n")).toMatch(/A skipped row came from the pipeline/);

    const written = await readOutages(testDb);
    expect(written).toHaveLength(2);
    const pipeline = written.find((row) => row.partner === "Scopely");
    expect(pipeline).toMatchObject({
      id: before[0]?.id,
      partnerId: null,
      affectedService: "IGS-BB",
      outageMinutes: "99",
      severity: "L0 — Catastrophic",
      source: "pipeline",
      decisionType: "system_written",
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
      pirUrl: "https://example.invalid/pipeline",
    });
    expect(pipeline?.incidentStarted).toEqual(incidentStarted);
    expect(written.find((row) => row.partner === "Niantic")).toMatchObject({
      source: "backfill",
      decisionType: null,
      outageMinutes: "23",
      affectedService: "Payments",
    });
  });

  it("dry-run validates and reports without writing", async () => {
    testDb = await createTestDatabase();
    await testDb.db.insert(slaOutages).values({
      pirKey: "ILLUSTRATIVE-1",
      partner: "Scopely",
      partnerId: "151639",
      incidentStarted: new Date("2026-04-16T16:46:00Z"),
      affectedService: "IGS-BB",
      outageMinutes: "17",
      severity: "L2 — Major",
      source: "backfill",
      decisionType: null,
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
      pirUrl: "https://example.invalid/illustrative",
    });
    const lines: string[] = [];
    const file = writeBackfill(VALID_ROWS);

    const result = await asRole(testDb, "ingestion_writer", () =>
      importBackfillFile(testDb!.db, file, {
        dryRun: true,
        write: (line) => lines.push(line),
      }),
    );

    expect(result.inserted).toBe(2);
    expect(result.pipelineSkipped).toBe(false);
    expect(result.skipped).toEqual([
      { pirKey: "ILLUSTRATIVE-1", partner: "Scopely", affectedService: "IGS-BB", source: "backfill" },
    ]);
    expect(lines.join("\n")).toMatch(/Dry run/);
    expect(lines.join("\n")).toMatch(/Would insert 2/);
    expect(lines.join("\n")).toMatch(/ILLUSTRATIVE-1 \| Scopely \| IGS-BB \| backfill/);
    const written = await readOutages(testDb);
    expect(written).toHaveLength(1);
    expect(written[0]?.partner).toBe("Scopely");
  });
});
