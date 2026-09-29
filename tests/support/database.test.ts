import { describe, expect, it } from "vitest";
import { loadOutages } from "@/data";
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

      // The harness's db must satisfy the same driver-neutral `Database`
      // type production code (writer/loader functions such as loadOutages)
      // is typed against, and sla_outages must actually exist by now — so
      // this calls loadOutages for real rather than asserting the type only.
      const partition = await loadOutages(db);
      expect(partition.usable).toEqual([]);
      expect(partition.unusable).toEqual([]);
    } finally {
      await close();
    }
  });
});
