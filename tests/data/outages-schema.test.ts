import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/database";

type OutageRowInput = {
  pirKey: string;
  partner: string;
  affectedService: string;
  incidentStarted: string;
  outageMinutes: number;
  source: string;
  decisionType: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

const BASE: OutageRowInput = {
  pirKey: "GTO-1",
  partner: "Scopely",
  affectedService: "Payments",
  incidentStarted: "2026-04-16T12:00:00.000Z",
  outageMinutes: 10,
  source: "pipeline",
  decisionType: "system_written",
  reviewedBy: null,
  reviewedAt: null,
};

async function insertOutage(testDb: TestDatabase, overrides: Partial<OutageRowInput> = {}) {
  const row = { ...BASE, ...overrides };
  return testDb.client.query(
    `insert into sla_outages
      (pir_key, partner, affected_service, incident_started, outage_minutes, source, decision_type, reviewed_by, reviewed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.pirKey,
      row.partner,
      row.affectedService,
      row.incidentStarted,
      row.outageMinutes,
      row.source,
      row.decisionType,
      row.reviewedBy,
      row.reviewedAt,
    ],
  );
}

describe("sla_outages schema", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("accepts a backfill row with null decision_type and null reviewed_by", async () => {
    testDb = await createTestDatabase();

    await expect(
      insertOutage(testDb, { source: "backfill", decisionType: null, reviewedBy: null, reviewedAt: null }),
    ).resolves.toBeDefined();
  });

  it("rejects a backfill row with a decision_type", async () => {
    testDb = await createTestDatabase();

    await expect(insertOutage(testDb, { source: "backfill" })).rejects.toThrow();
  });

  it("rejects a pipeline row with null decision_type", async () => {
    testDb = await createTestDatabase();

    await expect(insertOutage(testDb, { decisionType: null })).rejects.toThrow();
  });

  it("rejects human_corrected without reviewed_by, and without reviewed_at", async () => {
    testDb = await createTestDatabase();

    await expect(
      insertOutage(testDb, {
        decisionType: "human_corrected",
        reviewedBy: null,
        reviewedAt: "2026-04-16T13:00:00.000Z",
      }),
    ).rejects.toThrow();

    await expect(
      insertOutage(testDb, {
        pirKey: "GTO-2",
        decisionType: "human_corrected",
        reviewedBy: "ada",
        reviewedAt: null,
      }),
    ).rejects.toThrow();
  });

  it("rejects system_written with a reviewed_by", async () => {
    testDb = await createTestDatabase();

    await expect(insertOutage(testDb, { decisionType: "system_written", reviewedBy: "ada" })).rejects.toThrow();
  });

  it("rejects outage_minutes = 0", async () => {
    testDb = await createTestDatabase();

    await expect(insertOutage(testDb, { outageMinutes: 0 })).rejects.toThrow();
  });

  it("rejects a duplicate (pir_key, partner, affected_service)", async () => {
    testDb = await createTestDatabase();

    await insertOutage(testDb);

    await expect(insertOutage(testDb)).rejects.toThrow();
  });

  it("accepts the same PIR and partner with a second service", async () => {
    testDb = await createTestDatabase();

    await insertOutage(testDb);

    await expect(insertOutage(testDb, { affectedService: "Chat" })).resolves.toBeDefined();
  });
});
