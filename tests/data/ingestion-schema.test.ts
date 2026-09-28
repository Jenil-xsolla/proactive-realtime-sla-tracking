import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/database";

describe("sla_pir_reviews schema", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("rejects an unknown status", async () => {
    testDb = await createTestDatabase();

    await expect(
      testDb.client.query(
        `insert into sla_pir_reviews (pir_key, status, received_at, updated_at)
         values ($1, $2, now(), now())`,
        ["GTO-1", "bogus"],
      ),
    ).rejects.toThrow();
  });

  it("defaults version to 0", async () => {
    testDb = await createTestDatabase();

    await testDb.client.query(
      `insert into sla_pir_reviews (pir_key, status, received_at, updated_at)
       values ($1, $2, now(), now())`,
      ["GTO-2", "received"],
    );

    const result = await testDb.client.query<{ version: number }>(
      `select version from sla_pir_reviews where pir_key = $1`,
      ["GTO-2"],
    );

    expect(result.rows[0]?.version).toBe(0);
  });
});

describe("sla_outage_corrections schema", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("rejects a correction referencing an unknown pir_key", async () => {
    testDb = await createTestDatabase();

    await expect(
      testDb.client.query(
        `insert into sla_outage_corrections (pir_key, corrected_by, corrected_at, before, after)
         values ($1, $2, now(), $3, $4)`,
        ["GTO-does-not-exist", "ada", "{}", "{}"],
      ),
    ).rejects.toThrow();
  });
});
