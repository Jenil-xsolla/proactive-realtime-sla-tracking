import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAlertState, slaAlertState } from "@/data";
import { createTestDatabase, type TestDatabase } from "../support/database";

describe("listAlertState", () => {
  let test: TestDatabase;
  beforeEach(async () => {
    test = await createTestDatabase();
  });
  afterEach(async () => {
    await test.close();
  });

  it("lists rows newest alert first with never-alerted rows last", async () => {
    const at = (iso: string) => new Date(iso);
    await test.db.insert(slaAlertState).values([
      { partnerSlug: "scopely", scopeId: "payments", period: "2026-09", lastStatus: "meeting", lastAlertedAt: null, alertCount: 0, updatedAt: at("2026-09-02T00:00:00Z") },
      { partnerSlug: "niantic", scopeId: "payments", period: "2026-09", lastStatus: "breaching", lastAlertedAt: at("2026-09-20T01:00:00Z"), alertCount: 2, updatedAt: at("2026-09-20T01:00:00Z") },
      { partnerSlug: "kabam", scopeId: "tracking:login", period: "2026-09", lastStatus: "heads_up", lastAlertedAt: at("2026-09-10T13:00:00Z"), alertCount: 1, updatedAt: at("2026-09-10T13:00:00Z") },
    ]);
    const rows = await listAlertState(test.db);
    expect(rows.map((row) => row.partnerSlug)).toEqual(["niantic", "kabam", "scopely"]);
    expect(rows[0]).toMatchObject({ scopeId: "payments", period: "2026-09", lastStatus: "breaching", alertCount: 2 });
    expect(rows[0]?.lastAlertedAt).toEqual(at("2026-09-20T01:00:00Z"));
    expect(rows[2]?.lastAlertedAt).toBeNull();
  });
});
