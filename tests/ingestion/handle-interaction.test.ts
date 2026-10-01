import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { slaOutageCorrections, slaOutages, slaPirReviews, type Database } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";
import {
  applyCorrection,
  captureRows,
  getOutageRows,
  recordReceipt,
  saveSlackMessage,
  type ExtractedValues,
} from "@/ingestion/writer";
import { handleSlackInteraction, type InteractionDeps } from "@/ingestion/handle-interaction";
import { createTestDatabase, type TestDatabase } from "../support/database";

const T0 = new Date("2026-09-28T10:00:00.000Z");
const T1 = new Date("2026-09-28T11:00:00.000Z");
const INCIDENT_STARTED = new Date("2026-09-28T09:00:00.000Z");
const PIR_URL = "https://xsolla.atlassian.net/browse/GTO-543";

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
    pirKey: "GTO-543",
    partner: "Scopely",
    partnerId: "151639",
    affectedService: "Payments",
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

async function setupCaptured(
  testDb: TestDatabase,
  pirKey: string,
  rows: CaptureRow[],
  extractedValues: ExtractedValues = extracted(),
): Promise<void> {
  await recordReceipt(testDb.db, pirKey, T0);
  await captureRows(testDb.db, { pirKey, extracted: extractedValues, rows, unresolved: [] }, T0);
}

function makeDeps(testDb: TestDatabase, overrides: Partial<InteractionDeps> = {}) {
  const logs: string[] = [];
  const deps: InteractionDeps = {
    db: testDb.db,
    openView: vi.fn().mockResolvedValue({ ok: true }),
    updateMessage: vi.fn().mockResolvedValue({ ok: true }),
    triggerAlerts: vi.fn().mockResolvedValue({ ok: true }),
    now: () => T1,
    config: { slackToken: "xoxb-test" },
    log: (msg: string) => logs.push(msg),
    ...overrides,
  };
  return { deps, logs };
}

/**
 * A view of `db` whose `.transaction()` always throws, so `applyCorrection`
 * fails while everything read-only (`getOutageRows`, `getReviewForCorrection`)
 * still works normally. Every other member delegates to the real database,
 * bound to it so drizzle's internal `this` usage is unaffected.
 */
function dbWithThrowingTransaction(db: Database): Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "transaction") {
        return () => {
          throw new Error("simulated transaction failure");
        };
      }
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;
}

function fullValidValues(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    partners: {
      partners_select: { type: "multi_static_select", selected_options: [{ value: "scopely" }] },
    },
    services: {
      services_select: { type: "multi_static_select", selected_options: [{ value: "payments" }] },
    },
    incident_started: {
      incident_started_picker: { type: "datetimepicker", selected_date_time: 1758790800 },
    },
    minutes: {
      minutes_input: { type: "number_input", value: "45" },
    },
    severity: {
      severity_select: { type: "static_select", selected_option: { value: "l1" } },
    },
    reason: {
      reason_input: { type: "plain_text_input", value: "fixed it" },
    },
    ...overrides,
  };
}

function submissionPayload(
  pirKey: string,
  version: number,
  valuesOverrides: Record<string, Record<string, unknown>> = {},
  username: string | null = "alice",
) {
  return {
    type: "view_submission",
    user: username === null ? {} : { username },
    view: {
      callback_id: "sla_correction",
      private_metadata: JSON.stringify({ pirKey, version }),
      state: { values: fullValidValues(valuesOverrides) },
    },
  };
}

describe("handleSlackInteraction", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("block_actions correct click opens a modal whose private_metadata carries the current version", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(
      {
        type: "block_actions",
        trigger_id: "trigger-1",
        actions: [{ action_id: "correct", value: "GTO-543" }],
      },
      deps,
    );

    expect(result.body).toBeNull();
    expect(deps.openView).toHaveBeenCalledTimes(1);
    const call = (deps.openView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.token).toBe("xoxb-test");
    expect(call.triggerId).toBe("trigger-1");
    expect(JSON.parse(call.view.private_metadata)).toEqual({ pirKey: "GTO-543", version: 0 });
  });

  it("block_actions correct click with no review logs and returns null, without opening a view", async () => {
    testDb = await createTestDatabase();
    const { deps, logs } = makeDeps(testDb);

    const result = await handleSlackInteraction(
      {
        type: "block_actions",
        trigger_id: "trigger-1",
        actions: [{ action_id: "correct", value: "GTO-NOPE" }],
      },
      deps,
    );

    expect(result.body).toBeNull();
    expect(deps.openView).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("GTO-NOPE"))).toBe(true);
  });

  it("a view_submission that applies edits the message and triggers alerts via followUp", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    await saveSlackMessage(testDb.db, "GTO-543", { channel: "C0BUT8U637Y", ts: "111.222" }, T0);
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0), deps);

    expect(result.body).toEqual({ response_action: "clear" });
    expect(result.followUp).toBeTypeOf("function");

    const written = await testDb.db.select().from(slaOutages).where(eq(slaOutages.pirKey, "GTO-543"));
    expect(written).toHaveLength(1);
    expect(written[0]?.decisionType).toBe("human_corrected");
    expect(written[0]?.reviewedBy).toBe("alice");
    const review = await testDb.db.select().from(slaPirReviews).where(eq(slaPirReviews.pirKey, "GTO-543"));
    expect(review[0]?.version).toBe(1);

    await result.followUp!();

    expect(deps.updateMessage).toHaveBeenCalledTimes(1);
    const call = (deps.updateMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.channel).toBe("C0BUT8U637Y");
    expect(call.ts).toBe("111.222");
    const blocksText = JSON.stringify(call.blocks);
    expect(blocksText).toContain("Last corrected by");
    expect(blocksText).toContain("alice");
    expect(deps.triggerAlerts).toHaveBeenCalledTimes(1);
  });

  it("followUp re-reads current rows and the latest correction, not a stale snapshot from submission time", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    await saveSlackMessage(testDb.db, "GTO-543", { channel: "C0BUT8U637Y", ts: "111.222" }, T0);
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0), deps);
    expect(result.body).toEqual({ response_action: "clear" });

    // Simulate a second, later correction landing before this followUp runs:
    // after() callbacks are not guaranteed to run in submission order.
    await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-543",
        expectedVersion: 1,
        after: [row({ affectedService: "Login" })],
        extracted: extracted({ affectedServices: ["Login"] }),
        reason: "later correction",
        correctedBy: "bob",
      },
      new Date("2026-09-28T12:00:00.000Z"),
    );

    await result.followUp!();

    const call = (deps.updateMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const blocksText = JSON.stringify(call.blocks);
    expect(blocksText).toContain("Login");
    expect(blocksText).not.toContain("Payments");
    expect(blocksText).toContain("bob");
    expect(blocksText).not.toMatch(/Last corrected by alice/);
  });

  it("a stale version returns the exact error text, with no followUp and no writes", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    // Bump the version out from under expectedVersion 0.
    await applyCorrection(
      testDb.db,
      {
        pirKey: "GTO-543",
        expectedVersion: 0,
        after: [row()],
        extracted: extracted(),
        reason: null,
        correctedBy: "someone-else",
      },
      T0,
    );
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0), deps);

    expect(result.body).toEqual({
      response_action: "errors",
      errors: { partners: "someone else just corrected this; reopen to see the latest." },
    });
    expect(result.followUp).toBeUndefined();
    expect(deps.updateMessage).not.toHaveBeenCalled();
    expect(deps.triggerAlerts).not.toHaveBeenCalled();
  });

  it("a validation error returns response_action errors with no followUp", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(
      submissionPayload("GTO-543", 0, { minutes: { minutes_input: { type: "number_input", value: "0" } } }),
      deps,
    );

    expect(result.body).toEqual({
      response_action: "errors",
      errors: { minutes: expect.any(String) },
    });
    expect(result.followUp).toBeUndefined();
  });

  it("a missing Slack username returns a field error without saving", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0, {}, null), deps);

    expect(result.body).toEqual({
      response_action: "errors",
      errors: { reason: "Your Slack username could not be read; the correction was not saved." },
    });
    expect(result.followUp).toBeUndefined();
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("a view_submission for a PIR with no captured review returns the generic save-failed error, not a null body", async () => {
    testDb = await createTestDatabase();
    await recordReceipt(testDb.db, "GTO-999", T0); // received, never captured: no extracted values yet
    const { deps, logs } = makeDeps(testDb);

    const result = await handleSlackInteraction(submissionPayload("GTO-999", 0), deps);

    expect(result.body).toEqual({
      response_action: "errors",
      errors: { partners: "Could not save the correction; try again." },
    });
    expect(result.followUp).toBeUndefined();
    expect(logs.some((l) => l.includes("GTO-999"))).toBe(true);
  });

  it("a database failure applying the correction returns the generic save-failed error and writes nothing, not a null body", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    const throwingDb = dbWithThrowingTransaction(testDb.db);
    const { deps, logs } = makeDeps(testDb, { db: throwingDb });

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0), deps);

    expect(result.body).toEqual({
      response_action: "errors",
      errors: { partners: "Could not save the correction; try again." },
    });
    expect(result.followUp).toBeUndefined();
    expect(logs.some((l) => l.includes("simulated transaction failure"))).toBe(true);

    const corrections = await testDb.db
      .select()
      .from(slaOutageCorrections)
      .where(eq(slaOutageCorrections.pirKey, "GTO-543"));
    expect(corrections).toHaveLength(0);
    const outageRowsAfter = await getOutageRows(testDb.db, "GTO-543");
    expect(outageRowsAfter).toHaveLength(1);
    expect(outageRowsAfter[0]?.partner).toBe("Scopely");
    expect(outageRowsAfter[0]?.affectedService).toBe("Payments");
  });

  it("chat.update failure inside followUp is logged and followUp does not throw", async () => {
    testDb = await createTestDatabase();
    await setupCaptured(testDb, "GTO-543", [row()]);
    await saveSlackMessage(testDb.db, "GTO-543", { channel: "C0BUT8U637Y", ts: "111.222" }, T0);
    const { deps, logs } = makeDeps(testDb, {
      updateMessage: vi.fn().mockResolvedValue({ ok: false, error: "boom" }),
    });

    const result = await handleSlackInteraction(submissionPayload("GTO-543", 0), deps);
    expect(result.followUp).toBeTypeOf("function");

    await expect(result.followUp!()).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
    expect(deps.triggerAlerts).toHaveBeenCalledTimes(1);
  });

  it("an unknown payload type returns null", async () => {
    testDb = await createTestDatabase();
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction({ type: "shortcut" }, deps);

    expect(result.body).toBeNull();
    expect(result.followUp).toBeUndefined();
  });

  it("a non-object payload returns null without throwing", async () => {
    testDb = await createTestDatabase();
    const { deps } = makeDeps(testDb);

    const result = await handleSlackInteraction("not an object", deps);

    expect(result.body).toBeNull();
  });
});
