import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { slaOutageCorrections, slaOutages, slaPirReviews } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";
import { applyCorrection, captureRows, recordReceipt, type ExtractedValues } from "@/ingestion/writer";
import { createTestDatabase, type TestDatabase } from "../support/database";

const T0 = new Date("2026-09-28T10:00:00.000Z");
const T1 = new Date("2026-09-28T11:00:00.000Z");
const T2 = new Date("2026-09-28T12:00:00.000Z");
const INCIDENT_STARTED = new Date("2026-09-28T09:00:00.000Z");

const PIR_URL = "https://xsolla.atlassian.net/browse/GTO-543";

function extracted(overrides: Partial<ExtractedValues> = {}): ExtractedValues {
  return {
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    affectedServices: ["Pay Station", "Login"],
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

function row(overrides: Partial<CaptureRow> = {}): CaptureRow {
  return {
    pirKey: "GTO-543",
    partner: "Scopely",
    partnerId: "506855",
    affectedService: "Pay Station",
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

async function readOutageRows(testDb: TestDatabase, pirKey: string) {
  return testDb.db
    .select()
    .from(slaOutages)
    .where(eq(slaOutages.pirKey, pirKey))
    .orderBy(slaOutages.partner, slaOutages.affectedService);
}

async function readReview(testDb: TestDatabase, pirKey: string) {
  const rows = await testDb.db.select().from(slaPirReviews).where(eq(slaPirReviews.pirKey, pirKey));
  return rows[0];
}

async function readCorrections(testDb: TestDatabase, pirKey: string) {
  return testDb.db.select().from(slaOutageCorrections).where(eq(slaOutageCorrections.pirKey, pirKey));
}

async function setupCaptured(
  testDb: TestDatabase,
  pirKey: string,
  rows: CaptureRow[],
  extractedValues: ExtractedValues = extracted(),
): Promise<void> {
  await recordReceipt(testDb.db, pirKey, T0);
  await captureRows(testDb.db, { pirKey, extracted: extractedValues, rows, unresolved: [] }, T0);
}

describe("applyCorrection", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("removing a partner deletes that partner's rows", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [
      row({ partner: "Scopely", affectedService: "Pay Station" }),
      row({ partner: "Bandai Namco", partnerId: "503608", affectedService: "Pay Station" }),
    ]);

    const after: CaptureRow[] = [row({ partner: "Scopely", affectedService: "Pay Station" })];
    const result = await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-543",
        expectedVersion: 0,
        after,
        extracted: extracted(),
        reason: "Bandai Namco was misattributed",
        correctedBy: "jpatel",
      },
      T1,
    );

    expect(result).toEqual({ kind: "applied", version: 1 });
    const written = await readOutageRows(testDb, "GTO-543");
    expect(written).toHaveLength(1);
    expect(written[0]?.partner).toBe("Scopely");
  });

  it("removing a service deletes those rows", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-544", [
      row({ pirKey: "GTO-544", partner: "Scopely", affectedService: "Pay Station" }),
      row({ pirKey: "GTO-544", partner: "Scopely", affectedService: "Login" }),
    ]);

    const after: CaptureRow[] = [row({ pirKey: "GTO-544", partner: "Scopely", affectedService: "Pay Station" })];
    const result = await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-544",
        expectedVersion: 0,
        after,
        extracted: extracted(),
        reason: null,
        correctedBy: "jpatel",
      },
      T1,
    );

    expect(result).toEqual({ kind: "applied", version: 1 });
    const written = await readOutageRows(testDb, "GTO-544");
    expect(written).toHaveLength(1);
    expect(written[0]?.affectedService).toBe("Pay Station");
  });

  it("a second correction on the same expectedVersion is stale and writes nothing", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-545", [row({ pirKey: "GTO-545" })]);

    const first = await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-545",
        expectedVersion: 0,
        after: [row({ pirKey: "GTO-545", outageMinutes: 45 })],
        extracted: extracted({ outageMinutes: 45 }),
        reason: "first correction",
        correctedBy: "alice",
      },
      T1,
    );
    expect(first).toEqual({ kind: "applied", version: 1 });

    const second = await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-545",
        expectedVersion: 0,
        after: [row({ pirKey: "GTO-545", outageMinutes: 60 })],
        extracted: extracted({ outageMinutes: 60 }),
        reason: "second correction, stale",
        correctedBy: "bob",
      },
      T2,
    );
    expect(second).toEqual({ kind: "stale" });

    const written = await readOutageRows(testDb, "GTO-545");
    expect(written).toHaveLength(1);
    expect(written[0]?.outageMinutes).toBe("45");

    const corrections = await readCorrections(testDb, "GTO-545");
    expect(corrections).toHaveLength(1);

    const review = await readReview(testDb, "GTO-545");
    expect(review?.version).toBe(1);
  });

  it("every applied correction writes exactly one history row with correct before and after", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-546", [
      row({ pirKey: "GTO-546", partner: "Scopely", partnerId: "151639", affectedService: "Pay Station" }),
    ]);

    const after: CaptureRow[] = [
      row({ pirKey: "GTO-546", partner: "Scopely", partnerId: "151639", affectedService: "Login", outageMinutes: 50 }),
    ];
    await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-546",
        expectedVersion: 0,
        after,
        extracted: extracted({ outageMinutes: 50, affectedServices: ["Login"] }),
        reason: "service was wrong",
        correctedBy: "carol",
      },
      T1,
    );

    const corrections = await readCorrections(testDb, "GTO-546");
    expect(corrections).toHaveLength(1);
    const correction = corrections[0]!;
    expect(correction.correctedBy).toBe("carol");
    expect(correction.reason).toBe("service was wrong");
    expect(correction.before).toEqual([
      {
        partner: "Scopely",
        partnerId: "151639",
        affectedService: "Pay Station",
        incidentStarted: INCIDENT_STARTED.toISOString(),
        outageMinutes: 30,
        severity: "L1 — Critical",
      },
    ]);
    expect(correction.after).toEqual([
      {
        partner: "Scopely",
        partnerId: "151639",
        affectedService: "Login",
        incidentStarted: INCIDENT_STARTED.toISOString(),
        outageMinutes: 50,
        severity: "L1 — Critical",
      },
    ]);
  });

  it("clearing every partner leaves zero rows; a later redelivery leaves it at zero (D5)", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-547", [row({ pirKey: "GTO-547" })]);

    const result = await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-547",
        expectedVersion: 0,
        after: [],
        extracted: extracted(),
        reason: "no pilot partner affected",
        correctedBy: "dave",
      },
      T1,
    );
    expect(result).toEqual({ kind: "applied", version: 1 });

    const written = await readOutageRows(testDb, "GTO-547");
    expect(written).toHaveLength(0);

    const review = await readReview(testDb, "GTO-547");
    expect(review?.version).toBe(1);
    expect(review?.status).toBe("captured");
    expect(review?.unresolvedValues).toEqual([]);

    // A redelivery of the (now corrected, version > 0) PIR must never touch its rows.
    const redelivery = await captureRows(
      testDb.db,
      {
        pirKey: "GTO-547",
        extracted: extracted(),
        rows: [row({ pirKey: "GTO-547" })],
        unresolved: [],
      },
      T2,
    );
    expect(redelivery).toEqual({ kind: "corrected_untouched" });

    const afterRedelivery = await readOutageRows(testDb, "GTO-547");
    expect(afterRedelivery).toHaveLength(0);
  });

  it("written rows read back human_corrected with reviewedBy and reviewedAt", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-548", [row({ pirKey: "GTO-548" })]);

    await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-548",
        expectedVersion: 0,
        after: [row({ pirKey: "GTO-548", outageMinutes: 40 })],
        extracted: extracted({ outageMinutes: 40 }),
        reason: "fixed minutes",
        correctedBy: "erin",
      },
      T1,
    );

    const written = await readOutageRows(testDb, "GTO-548");
    expect(written).toHaveLength(1);
    expect(written[0]?.decisionType).toBe("human_corrected");
    expect(written[0]?.reviewedBy).toBe("erin");
    expect(written[0]?.reviewedAt).toEqual(T1);
    expect(written[0]?.reason).toBe("fixed minutes");
  });

  it("throws when correcting a PIR with no review row", async () => {
    testDb = await createTestDatabase();

    await expect(
      applyCorrection(
        testDb.db,
        {
          pirKey: "GTO-missing",
          expectedVersion: 0,
          after: [],
          extracted: extracted(),
          reason: null,
          correctedBy: "jpatel",
        },
        T0,
      ),
    ).rejects.toThrow();
  });
});
