import { afterEach, describe, expect, it } from "vitest";
import { loadIngestionHealth, loadOutages } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";
import {
  applyCorrection,
  captureRows,
  getLatestCorrection,
  getSlackRef,
  markCaptured,
  markFailed,
  markSkipped,
  recordReceipt,
  saveSlackError,
  saveSlackMessage,
  wasCaptured,
  type ExtractedValues,
} from "@/ingestion/writer";
import { createTestDatabase, type TestDatabase } from "../support/database";

/**
 * Integration check that the writer functions actually work under the
 * `sla_tracking_ingestion_writer` role's real GRANTs (not just under the test harness's
 * unrestricted owner connection every other writer test uses), and that the
 * dashboard's read functions work under `sla_tracking_app_user`'s. Complements
 * tests/data/grants.test.ts, which probes the GRANTs directly with raw SQL;
 * this exercises the actual functions the app calls, on PGlite with the
 * real migrations.
 */

async function asRole<T>(testDb: TestDatabase, role: string, fn: () => Promise<T>): Promise<T> {
  await testDb.client.query(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await testDb.client.query("RESET ROLE");
  }
}

const T0 = new Date("2026-09-28T10:00:00.000Z");
const T1 = new Date("2026-09-28T11:00:00.000Z");
const INCIDENT_STARTED = new Date("2026-09-28T09:00:00.000Z");
const PIR_URL = "https://xsolla.atlassian.net/browse/GTO-700";

function extracted(overrides: Partial<ExtractedValues> = {}): ExtractedValues {
  return {
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    affectedServices: ["Payments"],
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

function row(overrides: Partial<CaptureRow> = {}): CaptureRow {
  return {
    pirKey: "GTO-700",
    partner: "Scopely",
    partnerId: "506855",
    affectedService: "Payments",
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

describe("writer functions under their real database roles (spec §5.1)", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("recordReceipt, captureRows, applyCorrection and every other sla_tracking_ingestion_writer function succeed under SET ROLE sla_tracking_ingestion_writer", async () => {
    testDb = await createTestDatabase();

    await asRole(testDb, "sla_tracking_ingestion_writer", async () => {
      const receipt = await recordReceipt(testDb.db, "GTO-700", T0);
      expect(receipt.kind).toBe("new");

      const captureResult = await captureRows(
        testDb.db,
        { pirKey: "GTO-700", extracted: extracted(), rows: [row()], unresolved: [] },
        T0,
      );
      expect(captureResult).toEqual({ kind: "written", rowCount: 1 });

      const correctionResult = await applyCorrection(
        testDb.db,
        {
          pirKey: "GTO-700",
          expectedVersion: 0,
          after: [row({ partner: "Bandai Namco", partnerId: "700111" })],
          extracted: extracted(),
          reason: "wrong partner",
          correctedBy: "ada",
        },
        T1,
      );
      expect(correctionResult).toEqual({ kind: "applied", version: 1 });

      const latestCorrection = await getLatestCorrection(testDb.db, "GTO-700");
      expect(latestCorrection).toEqual({ by: "ada", at: T1 });

      await expect(getSlackRef(testDb.db, "GTO-700")).resolves.toEqual({
        slackChannel: null,
        slackTs: null,
      });

      await expect(
        saveSlackMessage(testDb.db, "GTO-700", { channel: "C0BUT8U637Y", ts: "1000.1" }, T1),
      ).resolves.toBeUndefined();
      await expect(saveSlackError(testDb.db, "GTO-700", "boom", T1)).resolves.toBeUndefined();
      await expect(markFailed(testDb.db, "GTO-700", "boom", T1)).resolves.toBeUndefined();
      await expect(markSkipped(testDb.db, "GTO-700", "no_outage", T1)).resolves.toBeUndefined();
      await expect(markCaptured(testDb.db, "GTO-700", T1)).resolves.toBeUndefined();
      await expect(wasCaptured(testDb.db, "GTO-700")).resolves.toBe(true);
    });
  });

  it("loadIngestionHealth and loadOutages succeed under SET ROLE sla_tracking_app_user", async () => {
    testDb = await createTestDatabase();
    // Seed as the unrestricted owner connection before switching role.
    await recordReceipt(testDb.db, "GTO-701", T0);
    await captureRows(
      testDb.db,
      { pirKey: "GTO-701", extracted: extracted(), rows: [row({ pirKey: "GTO-701" })], unresolved: [] },
      T0,
    );

    await asRole(testDb, "sla_tracking_app_user", async () => {
      await expect(loadIngestionHealth(testDb.db)).resolves.toBeDefined();
      const partition = await loadOutages(testDb.db);
      expect(partition.usable.length + partition.unusable.length).toBeGreaterThan(0);
    });
  });

  it("sla_tracking_app_user cannot run captureRows: permission denied on sla_outages", async () => {
    testDb = await createTestDatabase();
    // Seed as the unrestricted owner connection so there is a review row to
    // lock; the point of this test is the permission check, not a
    // "no such row" business error.
    await recordReceipt(testDb.db, "GTO-702", T0);

    await asRole(testDb, "sla_tracking_app_user", async () => {
      let thrown: unknown;
      try {
        await captureRows(
          testDb.db,
          { pirKey: "GTO-702", extracted: extracted(), rows: [row({ pirKey: "GTO-702" })], unresolved: [] },
          T0,
        );
      } catch (error) {
        thrown = error;
      }
      // Drizzle 0.45 wraps the driver error in DrizzleQueryError, whose own
      // .message is the failed SQL text, not the reason — the same shape
      // fix 2 (describeError) unwraps in the ingestion flow. The real
      // "permission denied" reason is on .cause.
      expect(thrown).toBeInstanceOf(Error);
      const cause = (thrown as Error).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/permission denied/);
    });
  });
});
