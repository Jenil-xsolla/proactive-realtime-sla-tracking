import { describe, expect, it } from "vitest";
import { loadOutages } from "@/data";
import type { Database } from "@/data/db";
import { createTestDatabase } from "./database";

describe("createTestDatabase", () => {
  it("applies the existing migrations", async () => {
    const { db, client, close } = await createTestDatabase();

    try {
      const result = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'sla_alert_state'",
      );
      const columnNames = result.rows.map((row) => row.column_name);

      expect(columnNames).toContain("partner_slug");
      expect(columnNames).not.toContain("partner_id");

      // Compile-time only: the harness's db must satisfy the same
      // driver-neutral `Database` type production code (writer/loader
      // functions such as loadOutages) is typed against. sla_outages
      // doesn't exist in the migrations yet, so this is asserted at the
      // type level and never actually invoked (which would fail at
      // runtime with a missing-table error).
      const _db: Database = db;
      const _dbForLoadOutages: Parameters<typeof loadOutages>[0] = db;
      void _db;
      void _dbForLoadOutages;
    } finally {
      await close();
    }
  });
});
