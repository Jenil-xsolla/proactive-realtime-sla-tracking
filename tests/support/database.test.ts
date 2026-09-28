import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./database";

describe("createTestDatabase", () => {
  it("applies the existing migrations", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const result = await db.execute(
        sql`select column_name from information_schema.columns where table_name = 'sla_alert_state'`,
      );
      const columnNames = result.rows.map((row) => (row as { column_name: string }).column_name);

      expect(columnNames).toContain("partner_slug");
      expect(columnNames).not.toContain("partner_id");
    } finally {
      await close();
    }
  });
});
