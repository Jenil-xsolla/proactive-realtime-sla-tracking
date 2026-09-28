import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { slaOutages, slaPirReviews } from "@/data";
import type { JiraFetchResult } from "@/ingestion/jira/client";
import type { PostMessageResult, UpdateMessageResult } from "@/slack/client";
import { handlePirApproved, type PirDeps, type PirFetchIssue, type PirOutcome } from "@/ingestion/handle-pir";
import { createTestDatabase, type TestDatabase } from "../support/database";
import gto200 from "../fixtures/jira/GTO-200.pir.json";
import gto199 from "../fixtures/jira/GTO-199.incident.json";
import gto1917 from "../fixtures/jira/GTO-1917.pir.json";
import gto1916 from "../fixtures/jira/GTO-1916.incident.json";
import gto2454 from "../fixtures/jira/GTO-2454.pir.json";
import gto913 from "../fixtures/jira/GTO-913.pir.json";

const BASE_URL = "https://xsolla.atlassian.net";
const SLACK_TOKEN = "xoxb-test-token";
const SLACK_CHANNEL = "C0BUT8U637Y";
const T0 = new Date("2026-09-28T10:00:00.000Z");

const FIXTURES: Record<string, unknown> = {
  "GTO-200": gto200,
  "GTO-199": gto199,
  "GTO-1917": gto1917,
  "GTO-1916": gto1916,
  "GTO-2454": gto2454,
  "GTO-913": gto913,
};

type PostCall = { channel: string; text: string; blocks?: unknown[] };
type UpdateCall = { channel: string; ts: string; text: string; blocks?: unknown[] };

function fakeFetchIssue(
  overrides: Record<string, JiraFetchResult | (() => Promise<JiraFetchResult>)> = {},
): { fetchIssue: PirFetchIssue; calls: string[] } {
  const calls: string[] = [];
  const fetchIssue: PirFetchIssue = async (input) => {
    calls.push(input.key);
    const override = overrides[input.key];
    if (override) {
      return typeof override === "function" ? override() : override;
    }
    const fixture = FIXTURES[input.key];
    if (fixture === undefined) {
      return { ok: false, error: `no fixture for ${input.key}` };
    }
    return { ok: true, json: fixture };
  };
  return { fetchIssue, calls };
}

function fakePostMessage(result: PostMessageResult = { ok: true, ts: "1000.1", channel: SLACK_CHANNEL }): {
  postMessage: PirDeps["postMessage"];
  calls: PostCall[];
} {
  const calls: PostCall[] = [];
  const postMessage: PirDeps["postMessage"] = async (input) => {
    calls.push({ channel: input.channel, text: input.text, blocks: input.blocks });
    return result;
  };
  return { postMessage, calls };
}

function fakeUpdateMessage(result: UpdateMessageResult = { ok: true }): {
  updateMessage: PirDeps["updateMessage"];
  calls: UpdateCall[];
} {
  const calls: UpdateCall[] = [];
  const updateMessage: PirDeps["updateMessage"] = async (input) => {
    calls.push({ channel: input.channel, ts: input.ts, text: input.text, blocks: input.blocks });
    return result;
  };
  return { updateMessage, calls };
}

function fakeTriggerAlerts(result: { ok: boolean; error?: string } = { ok: true }): {
  triggerAlerts: PirDeps["triggerAlerts"];
  calls: number;
  get: () => number;
} {
  let calls = 0;
  const triggerAlerts: PirDeps["triggerAlerts"] = async () => {
    calls += 1;
    return result;
  };
  return { triggerAlerts, calls, get: () => calls };
}

function buildDeps(testDb: TestDatabase, overrides: Partial<PirDeps> = {}): {
  deps: PirDeps;
  logs: string[];
  fetchCalls: string[];
  postCalls: PostCall[];
  updateCalls: UpdateCall[];
  triggerCalls: () => number;
} {
  const logs: string[] = [];
  const { fetchIssue, calls: fetchCalls } = fakeFetchIssue();
  const { postMessage, calls: postCalls } = fakePostMessage();
  const { updateMessage, calls: updateCalls } = fakeUpdateMessage();
  const trigger = fakeTriggerAlerts();

  const deps: PirDeps = {
    db: testDb.db,
    fetchIssue,
    postMessage,
    updateMessage,
    triggerAlerts: trigger.triggerAlerts,
    now: () => T0,
    config: { jiraBaseUrl: BASE_URL, slackToken: SLACK_TOKEN, slackChannel: SLACK_CHANNEL },
    log: (msg: string) => logs.push(msg),
    ...overrides,
  };

  return { deps, logs, fetchCalls, postCalls, updateCalls, triggerCalls: trigger.get };
}

async function readReview(testDb: TestDatabase, pirKey: string) {
  const rows = await testDb.db.select().from(slaPirReviews).where(eq(slaPirReviews.pirKey, pirKey));
  return rows[0];
}

async function readOutages(testDb: TestDatabase, pirKey: string) {
  return testDb.db
    .select()
    .from(slaOutages)
    .where(eq(slaOutages.pirKey, pirKey))
    .orderBy(slaOutages.partner);
}

describe("handlePirApproved", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    try {
      await testDb?.close();
    } catch {
      // Already closed by a test that deliberately breaks the connection.
    }
  });

  it("GTO-200: captures 7 partners x Payments, posts and saves the message, triggers alerts once", async () => {
    testDb = await createTestDatabase();
    const { deps, postCalls, updateCalls, triggerCalls } = buildDeps(testDb);

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: true });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.text).toContain("GTO-200 captured");
    expect(updateCalls).toHaveLength(0);
    expect(triggerCalls()).toBe(1);

    const rows = await readOutages(testDb, "GTO-200");
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.partner))).toEqual(
      new Set(["Scopely", "Niantic", "Bandai Namco", "Roblox", "Twitch", "Nexters", "Netmarble"]),
    );
    for (const row of rows) {
      expect(row.affectedService).toBe("Payments");
      expect(row.outageMinutes).toBe("25");
    }

    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("captured");
    expect(review?.slackTs).toBe("1000.1");
    expect(review?.slackChannel).toBe(SLACK_CHANNEL);
  });

  it("GTO-1917: two services, no merchant match -> captured with 0 rows, message still posted", async () => {
    testDb = await createTestDatabase();
    const { deps, postCalls } = buildDeps(testDb);

    const outcome = await handlePirApproved("GTO-1917", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 0, messagePosted: true });
    expect(postCalls).toHaveLength(1);

    const rows = await readOutages(testDb, "GTO-1917");
    expect(rows).toHaveLength(0);
  });

  it("GTO-2454: no_outage -> skipped, no Slack call", async () => {
    testDb = await createTestDatabase();
    const { deps, postCalls, updateCalls } = buildDeps(testDb);

    const outcome = await handlePirApproved("GTO-2454", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "skipped", reason: "no_outage" });
    expect(postCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);

    const review = await readReview(testDb, "GTO-2454");
    expect(review?.status).toBe("skipped");
    expect(review?.error).toBe("no_outage");
  });

  it("GTO-913: below_l2 -> skipped, no Slack call, and no incident fetch", async () => {
    testDb = await createTestDatabase();
    const { deps, postCalls, fetchCalls } = buildDeps(testDb);

    const outcome = await handlePirApproved("GTO-913", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "skipped", reason: "below_l2" });
    expect(postCalls).toHaveLength(0);
    expect(fetchCalls).toEqual(["GTO-913"]);
  });

  it("Jira fetch failure -> failed, notice posted, review marked failed", async () => {
    testDb = await createTestDatabase();
    const { fetchIssue } = fakeFetchIssue({ "GTO-200": { ok: false, error: "Jira is down" } });
    const { deps, postCalls } = buildDeps(testDb, { fetchIssue });

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "failed", error: "Jira is down" });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.text).toContain("GTO-200 failed to capture");

    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("failed");
    expect(review?.error).toBe("Jira is down");
  });

  it("DB write failure -> failed, notice posted, and NO capture message posted", async () => {
    testDb = await createTestDatabase();
    // Simulates a concurrent deletion of the review row between receipt and
    // capture: captureRows then throws for real (its documented behaviour),
    // exercising the same "database write fails mid-flight" failure mode
    // without mocking drizzle internals.
    const fetchIssue: PirFetchIssue = async (input) => {
      if (input.key === "GTO-199") {
        await testDb.db.delete(slaPirReviews).where(eq(slaPirReviews.pirKey, "GTO-200"));
        return { ok: true, json: gto199 };
      }
      const fixture = FIXTURES[input.key];
      return fixture === undefined ? { ok: false, error: "missing" } : { ok: true, json: fixture };
    };
    const { deps, postCalls } = buildDeps(testDb, { fetchIssue });

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error.toLowerCase()).toContain("capturerows");
    }
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.text).toContain("GTO-200 failed to capture");
    expect(postCalls.every((call) => !call.text.includes("captured. It will appear"))).toBe(true);

    const rows = await readOutages(testDb, "GTO-200");
    expect(rows).toHaveLength(0);
  });

  it("Slack ok:false on the capture message -> rows written, slack_error saved, messagePosted false", async () => {
    testDb = await createTestDatabase();
    const { postMessage } = fakePostMessage({ ok: false, error: "not_in_channel" });
    const { deps } = buildDeps(testDb, { postMessage });

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: false });

    const rows = await readOutages(testDb, "GTO-200");
    expect(rows).toHaveLength(7);

    const review = await readReview(testDb, "GTO-200");
    expect(review?.slackError).toBe("not_in_channel");
  });

  it("redelivery of an uncorrected PIR edits the message in place; postMessage is not called again", async () => {
    testDb = await createTestDatabase();
    const shared = buildDeps(testDb);
    await handlePirApproved("GTO-200", shared.deps);
    expect(shared.postCalls).toHaveLength(1);

    const outcome = await handlePirApproved("GTO-200", shared.deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: true });
    expect(shared.postCalls).toHaveLength(1);
    expect(shared.updateCalls).toHaveLength(1);
    expect(shared.updateCalls[0]?.ts).toBe("1000.1");
    expect(shared.updateCalls[0]?.channel).toBe(SLACK_CHANNEL);
  });

  it("redelivery of an uncorrected PIR: updateMessage ok:false -> slack_error saved, messagePosted false", async () => {
    testDb = await createTestDatabase();
    const shared = buildDeps(testDb);
    await handlePirApproved("GTO-200", shared.deps);
    expect(shared.postCalls).toHaveLength(1);

    const { updateMessage } = fakeUpdateMessage({ ok: false, error: "edit_window_closed" });
    const outcome = await handlePirApproved("GTO-200", { ...shared.deps, updateMessage });

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: false });

    const review = await readReview(testDb, "GTO-200");
    expect(review?.slackError).toBe("edit_window_closed");
  });

  it("redelivery of a corrected PIR posts the Jira-changed note, leaves rows unchanged, and does not trigger alerts", async () => {
    testDb = await createTestDatabase();
    const shared = buildDeps(testDb);
    await handlePirApproved("GTO-200", shared.deps);
    expect(shared.triggerCalls()).toBe(1);

    await testDb.db.update(slaPirReviews).set({ version: 1 }).where(eq(slaPirReviews.pirKey, "GTO-200"));
    const beforeRows = await readOutages(testDb, "GTO-200");

    const outcome = await handlePirApproved("GTO-200", shared.deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "corrected_untouched" });
    expect(shared.triggerCalls()).toBe(1); // unchanged from the first call
    expect(shared.postCalls).toHaveLength(2);
    expect(shared.postCalls[1]?.text).toContain("changed in Jira after a correction");

    const afterRows = await readOutages(testDb, "GTO-200");
    expect(afterRows).toEqual(beforeRows);
  });

  it("alert trigger failure is logged, not fatal; outcome is still captured", async () => {
    testDb = await createTestDatabase();
    const { triggerAlerts } = fakeTriggerAlerts({ ok: false, error: "dashboard unreachable" });
    const { deps, logs } = buildDeps(testDb, { triggerAlerts });

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: true });
    expect(logs.some((line) => line.includes("dashboard unreachable"))).toBe(true);
  });

  it("retry after a failed delivery proceeds normally once Jira is reachable again", async () => {
    testDb = await createTestDatabase();
    const { fetchIssue: failingFetch } = fakeFetchIssue({ "GTO-200": { ok: false, error: "Jira is down" } });
    const first = buildDeps(testDb, { fetchIssue: failingFetch });
    const firstOutcome = await handlePirApproved("GTO-200", first.deps);
    expect(firstOutcome.kind).toBe("failed");

    const second = buildDeps(testDb);
    const secondOutcome = await handlePirApproved("GTO-200", second.deps);

    expect(secondOutcome).toEqual<PirOutcome>({ kind: "captured", rowCount: 7, messagePosted: true });
    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("captured");
    expect(review?.error).toBeNull();
  });

  it("receipt failure (e.g. DB down) -> receipt_failed, best-effort notice, never throws", async () => {
    testDb = await createTestDatabase();
    await testDb.close();
    const { deps, postCalls } = buildDeps(testDb);

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome.kind).toBe("receipt_failed");
    if (outcome.kind !== "receipt_failed") return;
    expect(typeof outcome.error).toBe("string");
    // The notice post goes through the fake postMessage, which is
    // independent of the closed database, so it always succeeds.
    expect(postCalls).toHaveLength(1);
  });

  it("Jira key mismatch (a moved issue) -> failed with a clear error, using issueKey throughout", async () => {
    testDb = await createTestDatabase();
    const movedFixture = { ...gto200, key: "GTO-9999" };
    const fetchIssue: PirFetchIssue = async (input) => {
      if (input.key === "GTO-200") {
        return { ok: true, json: movedFixture };
      }
      const fixture = FIXTURES[input.key];
      return fixture === undefined ? { ok: false, error: "missing" } : { ok: true, json: fixture };
    };
    const { deps, postCalls } = buildDeps(testDb, { fetchIssue });

    const outcome = await handlePirApproved("GTO-200", deps);

    expect(outcome).toEqual<PirOutcome>({ kind: "failed", error: "Jira returned key GTO-9999 for GTO-200" });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.text).toContain("GTO-200 failed to capture");

    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("failed");
    expect(review?.error).toBe("Jira returned key GTO-9999 for GTO-200");
  });

  it("A1: a corrected PIR that fails then retries ends status captured, not stuck", async () => {
    testDb = await createTestDatabase();
    const shared = buildDeps(testDb);
    await handlePirApproved("GTO-200", shared.deps);
    await testDb.db.update(slaPirReviews).set({ version: 1 }).where(eq(slaPirReviews.pirKey, "GTO-200"));

    // Redelivery: Jira is briefly unreachable -> failed, even though corrected.
    const { fetchIssue: failingFetch } = fakeFetchIssue({ "GTO-200": { ok: false, error: "Jira is down" } });
    const failedOutcome = await handlePirApproved("GTO-200", { ...shared.deps, fetchIssue: failingFetch });
    expect(failedOutcome.kind).toBe("failed");
    expect((await readReview(testDb, "GTO-200"))?.status).toBe("failed");

    // Retrigger: Jira is reachable again; captureRows finds version > 0 and
    // reports corrected_untouched. Status must end up captured, not stuck
    // on received (what recordReceipt's retry path sets) or failed.
    const retryOutcome = await handlePirApproved("GTO-200", shared.deps);

    expect(retryOutcome).toEqual<PirOutcome>({ kind: "corrected_untouched" });
    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("captured");
    expect(review?.error).toBeNull();
  });

  it("A2: GTO-200 captured, then redelivered with minutes 0 -> rows unchanged, status captured, downgrade note posted, no trigger", async () => {
    testDb = await createTestDatabase();
    const shared = buildDeps(testDb);
    await handlePirApproved("GTO-200", shared.deps);
    expect(shared.triggerCalls()).toBe(1);
    const beforeRows = await readOutages(testDb, "GTO-200");
    expect(beforeRows).toHaveLength(7);

    const downgraded = { ...gto200, fields: { ...gto200.fields, customfield_31331: 0 } };
    const fetchIssue: PirFetchIssue = async (input) => {
      if (input.key === "GTO-200") {
        return { ok: true, json: downgraded };
      }
      const fixture = FIXTURES[input.key];
      return fixture === undefined ? { ok: false, error: "missing" } : { ok: true, json: fixture };
    };

    const outcome = await handlePirApproved("GTO-200", { ...shared.deps, fetchIssue });

    expect(outcome).toEqual<PirOutcome>({ kind: "downgraded_untouched", reason: "no_outage" });
    expect(shared.triggerCalls()).toBe(1); // unchanged
    expect(shared.postCalls).toHaveLength(2);
    expect(shared.postCalls[1]?.text).toContain("Jira now shows no outage");

    const afterRows = await readOutages(testDb, "GTO-200");
    expect(afterRows).toEqual(beforeRows);

    const review = await readReview(testDb, "GTO-200");
    expect(review?.status).toBe("captured");
  });

  it("retry variant: a never-captured PIR fails, then retries into a skip -> marked skipped as usual", async () => {
    testDb = await createTestDatabase();
    const { fetchIssue: failingFetch } = fakeFetchIssue({ "GTO-2454": { ok: false, error: "Jira is down" } });
    const first = buildDeps(testDb, { fetchIssue: failingFetch });
    const firstOutcome = await handlePirApproved("GTO-2454", first.deps);
    expect(firstOutcome.kind).toBe("failed");

    const second = buildDeps(testDb);
    const secondOutcome = await handlePirApproved("GTO-2454", second.deps);

    expect(secondOutcome).toEqual<PirOutcome>({ kind: "skipped", reason: "no_outage" });
    expect(second.postCalls).toHaveLength(0);
    const review = await readReview(testDb, "GTO-2454");
    expect(review?.status).toBe("skipped");
    expect(review?.incidentStarted).toBeNull();
  });
});
