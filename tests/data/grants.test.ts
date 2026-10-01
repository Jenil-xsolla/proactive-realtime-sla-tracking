import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/database";

/**
 * Verifies the per-service database boundary from main spec §5.1: `app_user`
 * (sla-dashboard) and `ingestion_writer` (sla-ingestion) each get exactly the
 * privileges the spec table lists, nothing more.
 *
 * PGlite honours `SET ROLE` and enforces GRANT-based privileges under it
 * (confirmed by probing INSERT-without-GRANT, which raises "permission
 * denied" exactly as real Postgres does), so these tests switch role with
 * `SET ROLE` / `RESET ROLE` around each statement under test rather than
 * falling back to reading `information_schema.role_table_grants`.
 */

async function asRole(testDb: TestDatabase, role: string, fn: () => Promise<unknown>) {
  await testDb.client.query(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await testDb.client.query("RESET ROLE");
  }
}

async function seedPirReview(testDb: TestDatabase, pirKey: string) {
  await testDb.client.query(
    `insert into sla_pir_reviews (pir_key, status, received_at, updated_at)
     values ($1, $2, now(), now())`,
    [pirKey, "received"],
  );
}

async function seedOutage(testDb: TestDatabase, pirKey: string) {
  await testDb.client.query(
    `insert into sla_outages
      (pir_key, partner, affected_service, incident_started, outage_minutes, source, decision_type)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [pirKey, "Scopely", "Payments", "2026-04-16T12:00:00.000Z", 10, "pipeline", "system_written"],
  );
}

async function seedCorrection(testDb: TestDatabase, pirKey: string) {
  await testDb.client.query(
    `insert into sla_outage_corrections (pir_key, corrected_by, corrected_at, before, after)
     values ($1, $2, now(), $3, $4)`,
    [pirKey, "ada", "{}", "{}"],
  );
}

describe("service grants (spec §5.1)", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("app_user can SELECT all three ingestion tables but cannot INSERT into sla_outages", async () => {
    testDb = await createTestDatabase();
    await seedPirReview(testDb, "GTO-1");
    await seedOutage(testDb, "GTO-1");
    await seedCorrection(testDb, "GTO-1");

    await asRole(testDb, "app_user", async () => {
      await expect(testDb.client.query("SELECT * FROM sla_outages")).resolves.toBeDefined();
      await expect(testDb.client.query("SELECT * FROM sla_pir_reviews")).resolves.toBeDefined();
      await expect(testDb.client.query("SELECT * FROM sla_outage_corrections")).resolves.toBeDefined();

      await expect(
        testDb.client.query(
          `insert into sla_outages
            (pir_key, partner, affected_service, incident_started, outage_minutes, source, decision_type)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          ["GTO-2", "Scopely", "Payments", "2026-04-16T12:00:00.000Z", 10, "pipeline", "system_written"],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("app_user can write sla_alert_state", async () => {
    testDb = await createTestDatabase();

    await asRole(testDb, "app_user", async () => {
      await expect(
        testDb.client.query(
          `insert into sla_alert_state (partner_slug, scope_id, period, last_status, updated_at)
           values ($1, $2, $3, $4, now())`,
          ["second-dinner", "scope-1", "2026-04", "green"],
        ),
      ).resolves.toBeDefined();

      await expect(
        testDb.client.query(
          `update sla_alert_state set last_status = $1 where partner_slug = $2 and scope_id = $3 and period = $4`,
          ["red", "second-dinner", "scope-1", "2026-04"],
        ),
      ).resolves.toBeDefined();
    });
  });

  it("ingestion_writer can DELETE from sla_outages", async () => {
    testDb = await createTestDatabase();
    await seedOutage(testDb, "GTO-3");

    await asRole(testDb, "ingestion_writer", async () => {
      await expect(
        testDb.client.query("DELETE FROM sla_outages WHERE pir_key = $1", ["GTO-3"]),
      ).resolves.toBeDefined();
    });
  });

  it("ingestion_writer cannot touch sla_alert_state", async () => {
    testDb = await createTestDatabase();

    await asRole(testDb, "ingestion_writer", async () => {
      await expect(testDb.client.query("SELECT * FROM sla_alert_state")).rejects.toThrow(/permission denied/);

      await expect(
        testDb.client.query(
          `insert into sla_alert_state (partner_slug, scope_id, period, last_status, updated_at)
           values ($1, $2, $3, $4, now())`,
          ["second-dinner", "scope-1", "2026-04", "green"],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("ingestion_writer cannot UPDATE or DELETE sla_outage_corrections", async () => {
    testDb = await createTestDatabase();
    await seedPirReview(testDb, "GTO-4");
    await seedCorrection(testDb, "GTO-4");

    await asRole(testDb, "ingestion_writer", async () => {
      await expect(
        testDb.client.query(`update sla_outage_corrections set reason = $1 where pir_key = $2`, ["oops", "GTO-4"]),
      ).rejects.toThrow(/permission denied/);

      await expect(
        testDb.client.query(`delete from sla_outage_corrections where pir_key = $1`, ["GTO-4"]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("app_user can read and write sla_contract_terms but cannot delete it", async () => {
    testDb = await createTestDatabase();

    await asRole(testDb, "app_user", async () => {
      await expect(
        testDb.client.query(
          `insert into sla_contract_terms (partner_slug, lifecycle, terms, updated_by, updated_at, created_at)
           values ($1, $2, $3, $4, now(), now())`,
          ["roblox", "contract_bound", "{}", "ada"],
        ),
      ).resolves.toBeDefined();

      await expect(testDb.client.query("SELECT * FROM sla_contract_terms")).resolves.toBeDefined();

      await expect(
        testDb.client.query(`update sla_contract_terms set updated_by = $1 where partner_slug = $2`, [
          "grace",
          "roblox",
        ]),
      ).resolves.toBeDefined();

      await expect(
        testDb.client.query(`delete from sla_contract_terms where partner_slug = $1`, ["roblox"]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("ingestion_writer cannot read or write sla_contract_terms", async () => {
    testDb = await createTestDatabase();

    await asRole(testDb, "ingestion_writer", async () => {
      await expect(testDb.client.query("SELECT * FROM sla_contract_terms")).rejects.toThrow(/permission denied/);

      await expect(
        testDb.client.query(
          `insert into sla_contract_terms (partner_slug, lifecycle, terms, updated_by, updated_at, created_at)
           values ($1, $2, $3, $4, now(), now())`,
          ["roblox", "contract_bound", "{}", "ada"],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("ingestion_writer can INSERT into sla_outages and sla_outage_corrections using the serial sequences", async () => {
    testDb = await createTestDatabase();
    await seedPirReview(testDb, "GTO-5");

    await asRole(testDb, "ingestion_writer", async () => {
      await expect(
        testDb.client.query(
          `insert into sla_outages
            (pir_key, partner, affected_service, incident_started, outage_minutes, source, decision_type)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          ["GTO-5", "Scopely", "Payments", "2026-04-16T12:00:00.000Z", 10, "pipeline", "system_written"],
        ),
      ).resolves.toBeDefined();

      await expect(
        testDb.client.query(
          `insert into sla_outage_corrections (pir_key, corrected_by, corrected_at, before, after)
           values ($1, $2, now(), $3, $4)`,
          ["GTO-5", "ada", "{}", "{}"],
        ),
      ).resolves.toBeDefined();
    });
  });
});
