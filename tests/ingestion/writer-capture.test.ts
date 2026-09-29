import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { slaOutages, slaPirReviews } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";
import { captureRows, recordReceipt, type ExtractedValues } from "@/ingestion/writer";
import { createTestDatabase, type TestDatabase } from "../support/database";

const T0 = new Date("2026-09-28T10:00:00.000Z");
const T1 = new Date("2026-09-28T11:00:00.000Z");
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

describe("captureRows", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("writes one row per (partner, service) for a 2x2 cross product", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-543", T0);

    const rows: CaptureRow[] = [
      row({ partner: "Scopely", affectedService: "Pay Station" }),
      row({ partner: "Scopely", affectedService: "Login" }),
      row({ partner: "Bandai Namco", partnerId: "700111", affectedService: "Pay Station" }),
      row({ partner: "Bandai Namco", partnerId: "700111", affectedService: "Login" }),
    ];

    const result = await captureRows(
      testDb.db,
      { pirKey: "GTO-543", extracted: extracted(), rows, unresolved: [] },
      T1,
    );

    expect(result).toEqual({ kind: "written", rowCount: 4 });

    const written = await readOutageRows(testDb, "GTO-543");
    expect(written).toHaveLength(4);
    for (const outage of written) {
      expect(outage.source).toBe("pipeline");
      expect(outage.decisionType).toBe("system_written");
      expect(outage.reviewedBy).toBeNull();
      expect(outage.reviewedAt).toBeNull();
    }

    const review = await readReview(testDb, "GTO-543");
    expect(review?.status).toBe("captured");
    expect(review?.updatedAt).toEqual(T1);
  });

  it("redelivery with changed minutes refreshes the system_written rows", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-1", T0);

    const firstRows: CaptureRow[] = [row({ pirKey: "GTO-1", outageMinutes: 30 })];
    await captureRows(
      testDb.db,
      { pirKey: "GTO-1", extracted: extracted({ outageMinutes: 30 }), rows: firstRows, unresolved: [] },
      T0,
    );

    const secondRows: CaptureRow[] = [row({ pirKey: "GTO-1", outageMinutes: 45 })];
    const result = await captureRows(
      testDb.db,
      { pirKey: "GTO-1", extracted: extracted({ outageMinutes: 45 }), rows: secondRows, unresolved: [] },
      T1,
    );

    expect(result).toEqual({ kind: "written", rowCount: 1 });
    const written = await readOutageRows(testDb, "GTO-1");
    expect(written).toHaveLength(1);
    expect(written[0]?.outageMinutes).toBe("45");
  });

  it("redelivery dropping a partner deletes that partner's rows", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-2", T0);

    const firstRows: CaptureRow[] = [
      row({ pirKey: "GTO-2", partner: "Scopely", affectedService: "Pay Station" }),
      row({ pirKey: "GTO-2", partner: "Bandai Namco", partnerId: "700111", affectedService: "Pay Station" }),
    ];
    await captureRows(
      testDb.db,
      { pirKey: "GTO-2", extracted: extracted(), rows: firstRows, unresolved: [] },
      T0,
    );

    const secondRows: CaptureRow[] = [
      row({ pirKey: "GTO-2", partner: "Scopely", affectedService: "Pay Station" }),
    ];
    const result = await captureRows(
      testDb.db,
      { pirKey: "GTO-2", extracted: extracted(), rows: secondRows, unresolved: [] },
      T1,
    );

    expect(result).toEqual({ kind: "written", rowCount: 1 });
    const written = await readOutageRows(testDb, "GTO-2");
    expect(written).toHaveLength(1);
    expect(written[0]?.partner).toBe("Scopely");
  });

  it("redelivery dropping a service deletes those rows", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-8", T0);

    const firstRows: CaptureRow[] = [
      row({ pirKey: "GTO-8", partner: "Scopely", affectedService: "Pay Station" }),
      row({ pirKey: "GTO-8", partner: "Scopely", affectedService: "Login" }),
    ];
    await captureRows(
      testDb.db,
      { pirKey: "GTO-8", extracted: extracted(), rows: firstRows, unresolved: [] },
      T0,
    );

    const secondRows: CaptureRow[] = [
      row({ pirKey: "GTO-8", partner: "Scopely", affectedService: "Pay Station" }),
    ];
    const result = await captureRows(
      testDb.db,
      { pirKey: "GTO-8", extracted: extracted(), rows: secondRows, unresolved: [] },
      T1,
    );

    expect(result).toEqual({ kind: "written", rowCount: 1 });
    const written = await readOutageRows(testDb, "GTO-8");
    expect(written).toHaveLength(1);
    expect(written[0]?.affectedService).toBe("Pay Station");
  });

  it("leaves a corrected PIR (version > 0) untouched, including one with zero rows", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-3", T0);

    const firstRows: CaptureRow[] = [row({ pirKey: "GTO-3" })];
    await captureRows(
      testDb.db,
      { pirKey: "GTO-3", extracted: extracted(), rows: firstRows, unresolved: [] },
      T0,
    );

    // Simulate a correction having bumped the version and (per D5) possibly
    // left the PIR with zero rows in sla_outages; the review's extracted
    // values are whatever the correction stored, distinct from what a
    // redelivery would extract.
    await testDb.db.delete(slaOutages).where(eq(slaOutages.pirKey, "GTO-3"));
    await testDb.db
      .update(slaPirReviews)
      .set({ version: 1, severity: "L2 — Major" })
      .where(eq(slaPirReviews.pirKey, "GTO-3"));

    const beforeReview = await readReview(testDb, "GTO-3");

    const result = await captureRows(
      testDb.db,
      {
        pirKey: "GTO-3",
        extracted: extracted({ severity: "L1 — Critical", outageMinutes: 999 }),
        rows: [row({ pirKey: "GTO-3", outageMinutes: 999 })],
        unresolved: [{ kind: "merchant", raw: "some redelivered text" }],
      },
      T1,
    );

    expect(result).toEqual({ kind: "corrected_untouched" });

    const afterRows = await readOutageRows(testDb, "GTO-3");
    expect(afterRows).toHaveLength(0);

    const afterReview = await readReview(testDb, "GTO-3");
    expect(afterReview).toEqual(beforeReview);
  });

  it("zero resolved partners writes zero rows, marks captured, and stores unresolved values", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-4", T0);

    const unresolved = [{ kind: "merchant" as const, raw: "Some Unmatched Merchant" }];
    const result = await captureRows(
      testDb.db,
      { pirKey: "GTO-4", extracted: extracted(), rows: [], unresolved },
      T1,
    );

    expect(result).toEqual({ kind: "written", rowCount: 0 });

    const written = await readOutageRows(testDb, "GTO-4");
    expect(written).toHaveLength(0);

    const review = await readReview(testDb, "GTO-4");
    expect(review?.status).toBe("captured");
    expect(review?.unresolvedValues).toEqual(unresolved);
  });

  it("throws when capturing a PIR with no review row", async () => {
    testDb = await createTestDatabase();

    await expect(
      captureRows(
        testDb.db,
        { pirKey: "GTO-missing", extracted: extracted(), rows: [], unresolved: [] },
        T0,
      ),
    ).rejects.toThrow();
  });
});
