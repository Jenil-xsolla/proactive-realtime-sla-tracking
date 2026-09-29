import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { slaPirReviews } from "@/data";
import { markFailed, markSkipped, recordReceipt, saveSlackError, saveSlackMessage } from "@/ingestion/writer";
import { createTestDatabase, type TestDatabase } from "../support/database";

const T0 = new Date("2026-09-28T10:00:00.000Z");
const T1 = new Date("2026-09-28T10:05:00.000Z");
const T2 = new Date("2026-09-28T10:10:00.000Z");

async function readRow(testDb: TestDatabase, pirKey: string) {
  const rows = await testDb.db.select().from(slaPirReviews).where(eq(slaPirReviews.pirKey, pirKey));
  return rows[0];
}

describe("recordReceipt", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("inserts a received row for a PIR seen for the first time", async () => {
    testDb = await createTestDatabase();

    const result = await recordReceipt(testDb.db, "GTO-543", T0);

    expect(result).toEqual({ kind: "new", version: 0 });
    const row = await readRow(testDb, "GTO-543");
    expect(row?.status).toBe("received");
    expect(row?.receivedAt).toEqual(T0);
    expect(row?.updatedAt).toEqual(T0);
  });

  it("moves a failed PIR back to received and clears the error (retry)", async () => {
    testDb = await createTestDatabase();
    await testDb.db.insert(slaPirReviews).values({
      pirKey: "GTO-1",
      status: "failed",
      version: 1,
      error: "Missing JIRA_BASE_URL",
      receivedAt: T0,
      updatedAt: T0,
    });

    const result = await recordReceipt(testDb.db, "GTO-1", T1);

    expect(result).toEqual({ kind: "retry", version: 1 });
    const row = await readRow(testDb, "GTO-1");
    expect(row?.status).toBe("received");
    expect(row?.error).toBeNull();
    expect(row?.updatedAt).toEqual(T1);
    expect(row?.receivedAt).toEqual(T0);
  });

  it("moves a skipped PIR back to received (retry, A8)", async () => {
    testDb = await createTestDatabase();
    await testDb.db.insert(slaPirReviews).values({
      pirKey: "GTO-2",
      status: "skipped",
      version: 0,
      error: "L3 — Limited severity is not captured",
      receivedAt: T0,
      updatedAt: T0,
    });

    const result = await recordReceipt(testDb.db, "GTO-2", T1);

    expect(result).toEqual({ kind: "retry", version: 0 });
    const row = await readRow(testDb, "GTO-2");
    expect(row?.status).toBe("received");
    expect(row?.error).toBeNull();
    expect(row?.updatedAt).toEqual(T1);
  });

  it("re-marks a still-received PIR as received (retry, an earlier attempt died mid-request, A8)", async () => {
    testDb = await createTestDatabase();
    await testDb.db.insert(slaPirReviews).values({
      pirKey: "GTO-3",
      status: "received",
      version: 0,
      receivedAt: T0,
      updatedAt: T0,
    });

    const result = await recordReceipt(testDb.db, "GTO-3", T1);

    expect(result).toEqual({ kind: "retry", version: 0 });
    const row = await readRow(testDb, "GTO-3");
    expect(row?.status).toBe("received");
    expect(row?.updatedAt).toEqual(T1);
  });

  it("leaves a captured PIR untouched and reports redelivery", async () => {
    testDb = await createTestDatabase();
    await testDb.db.insert(slaPirReviews).values({
      pirKey: "GTO-4",
      status: "captured",
      version: 2,
      receivedAt: T0,
      updatedAt: T0,
    });

    const result = await recordReceipt(testDb.db, "GTO-4", T1);

    expect(result).toEqual({ kind: "redelivery", version: 2 });
    const row = await readRow(testDb, "GTO-4");
    expect(row?.status).toBe("captured");
    expect(row?.updatedAt).toEqual(T0);
  });

  it("receipt-first: a failure after recordReceipt still leaves a failed row, never nothing", async () => {
    testDb = await createTestDatabase();

    await recordReceipt(testDb.db, "GTO-5", T0);
    await markFailed(testDb.db, "GTO-5", "Jira returned HTTP 500 for GTO-5", T1);

    const row = await readRow(testDb, "GTO-5");
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("Jira returned HTTP 500 for GTO-5");
    expect(row?.receivedAt).toEqual(T0);
    expect(row?.updatedAt).toEqual(T1);
  });
});

describe("markSkipped", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("stores the skip reason in the error column and sets updatedAt", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-6", T0);

    await markSkipped(testDb.db, "GTO-6", "L4 — Minor severity is not captured", T1);

    const row = await readRow(testDb, "GTO-6");
    expect(row?.status).toBe("skipped");
    expect(row?.error).toBe("L4 — Minor severity is not captured");
    expect(row?.updatedAt).toEqual(T1);
  });

  it("throws when the PIR was never received", async () => {
    testDb = await createTestDatabase();

    await expect(markSkipped(testDb.db, "GTO-missing", "reason", T0)).rejects.toThrow();
  });
});

describe("markFailed", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("throws when the PIR was never received", async () => {
    testDb = await createTestDatabase();

    await expect(markFailed(testDb.db, "GTO-missing", "boom", T0)).rejects.toThrow();
  });
});

describe("saveSlackMessage and saveSlackError", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("round-trips: saving a message clears any prior error, and a later error leaves the message reference intact", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-7", T0);

    await saveSlackMessage(testDb.db, "GTO-7", { channel: "C0BUT8U637Y", ts: "1700000000.000100" }, T1);

    let row = await readRow(testDb, "GTO-7");
    expect(row?.slackChannel).toBe("C0BUT8U637Y");
    expect(row?.slackTs).toBe("1700000000.000100");
    expect(row?.slackError).toBeNull();
    expect(row?.updatedAt).toEqual(T1);

    await saveSlackError(testDb.db, "GTO-7", "chat.update failed: rate_limited", T2);

    row = await readRow(testDb, "GTO-7");
    expect(row?.slackChannel).toBe("C0BUT8U637Y");
    expect(row?.slackTs).toBe("1700000000.000100");
    expect(row?.slackError).toBe("chat.update failed: rate_limited");
    expect(row?.updatedAt).toEqual(T2);
  });

  it("saveSlackMessage throws when the PIR was never received", async () => {
    testDb = await createTestDatabase();

    await expect(
      saveSlackMessage(testDb.db, "GTO-missing", { channel: "C1", ts: "1.1" }, T0),
    ).rejects.toThrow();
  });

  it("saveSlackError throws when the PIR was never received", async () => {
    testDb = await createTestDatabase();

    await expect(saveSlackError(testDb.db, "GTO-missing", "boom", T0)).rejects.toThrow();
  });
});
