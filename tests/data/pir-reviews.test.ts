import { afterEach, describe, expect, it } from "vitest";
import { loadIngestionHealth, type UnresolvedValue } from "@/data";
import { createTestDatabase, type TestDatabase } from "../support/database";

type ReviewInput = {
  pirKey: string;
  status: "received" | "skipped" | "captured" | "failed";
  updatedAt: string;
  pirUrl?: string | null;
  error?: string | null;
  unresolvedValues?: UnresolvedValue[];
  slackError?: string | null;
};

async function insertReview(testDb: TestDatabase, input: ReviewInput): Promise<void> {
  await testDb.client.query(
    `insert into sla_pir_reviews
      (pir_key, status, received_at, updated_at, pir_url, error, unresolved_values, slack_error)
     values ($1, $2, $3, $3, $4, $5, $6, $7)`,
    [
      input.pirKey,
      input.status,
      input.updatedAt,
      input.pirUrl ?? null,
      input.error ?? null,
      JSON.stringify(input.unresolvedValues ?? []),
      input.slackError ?? null,
    ],
  );
}

describe("loadIngestionHealth", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("lists failed PIRs ordered by updatedAt desc, with pirKey, pirUrl, error and updatedAt", async () => {
    testDb = await createTestDatabase();
    await insertReview(testDb, {
      pirKey: "GTO-1",
      status: "failed",
      updatedAt: "2026-04-16T12:00:00.000Z",
      pirUrl: "https://jira.example/browse/GTO-1",
      error: "Jira fetch failed",
    });
    await insertReview(testDb, {
      pirKey: "GTO-2",
      status: "failed",
      updatedAt: "2026-04-17T12:00:00.000Z",
      error: "Missing incident link",
    });

    const health = await loadIngestionHealth(testDb.db);

    expect(health.failed.totalCount).toBe(2);
    expect(health.failed.items).toEqual([
      {
        pirKey: "GTO-2",
        pirUrl: null,
        error: "Missing incident link",
        updatedAt: new Date("2026-04-17T12:00:00.000Z"),
      },
      {
        pirKey: "GTO-1",
        pirUrl: "https://jira.example/browse/GTO-1",
        error: "Jira fetch failed",
        updatedAt: new Date("2026-04-16T12:00:00.000Z"),
      },
    ]);
  });

  it("lists captured PIRs with non-empty unresolved values, and excludes captured PIRs with none", async () => {
    testDb = await createTestDatabase();
    const unresolved: UnresolvedValue[] = [{ kind: "merchant", raw: "Some Studio LLC" }];
    await insertReview(testDb, {
      pirKey: "GTO-3",
      status: "captured",
      updatedAt: "2026-04-18T12:00:00.000Z",
      pirUrl: "https://jira.example/browse/GTO-3",
      unresolvedValues: unresolved,
    });
    await insertReview(testDb, {
      pirKey: "GTO-4",
      status: "captured",
      updatedAt: "2026-04-19T12:00:00.000Z",
      unresolvedValues: [],
    });

    const health = await loadIngestionHealth(testDb.db);

    expect(health.unresolved.totalCount).toBe(1);
    expect(health.unresolved.items).toEqual([
      { pirKey: "GTO-3", pirUrl: "https://jira.example/browse/GTO-3", values: unresolved },
    ]);
  });

  it("lists captured PIRs without a Slack message, keyed on slack_error not null", async () => {
    testDb = await createTestDatabase();
    await insertReview(testDb, {
      pirKey: "GTO-5",
      status: "captured",
      updatedAt: "2026-04-20T12:00:00.000Z",
      pirUrl: "https://jira.example/browse/GTO-5",
      slackError: "channel_not_found",
    });
    await insertReview(testDb, {
      pirKey: "GTO-6",
      status: "captured",
      updatedAt: "2026-04-21T12:00:00.000Z",
      slackError: null,
    });

    const health = await loadIngestionHealth(testDb.db);

    expect(health.withoutMessage.totalCount).toBe(1);
    expect(health.withoutMessage.items).toEqual([
      { pirKey: "GTO-5", pirUrl: "https://jira.example/browse/GTO-5", slackError: "channel_not_found" },
    ]);
  });

  it("excludes received and skipped PIRs from every list", async () => {
    testDb = await createTestDatabase();
    await insertReview(testDb, {
      pirKey: "GTO-7",
      status: "received",
      updatedAt: "2026-04-22T12:00:00.000Z",
      error: "should not appear",
    });
    await insertReview(testDb, {
      pirKey: "GTO-8",
      status: "skipped",
      updatedAt: "2026-04-23T12:00:00.000Z",
      error: "no outage on this PIR",
      unresolvedValues: [{ kind: "service_ari", raw: "ari:cloud:graph::service/x" }],
      slackError: "should not appear either",
    });

    const health = await loadIngestionHealth(testDb.db);

    expect(health.failed.totalCount).toBe(0);
    expect(health.unresolved.totalCount).toBe(0);
    expect(health.withoutMessage.totalCount).toBe(0);
  });

  it("caps each list at 50 while keeping the true total count", async () => {
    testDb = await createTestDatabase();
    for (let i = 0; i < 55; i += 1) {
      await insertReview(testDb, {
        pirKey: `GTO-F${i}`,
        status: "failed",
        updatedAt: new Date(Date.UTC(2026, 3, 1, 0, i)).toISOString(),
        error: `error ${i}`,
      });
    }

    const health = await loadIngestionHealth(testDb.db);

    expect(health.failed.totalCount).toBe(55);
    expect(health.failed.items).toHaveLength(50);
    // Most recently updated (i = 54) sorts first.
    expect(health.failed.items[0]?.pirKey).toBe("GTO-F54");
  });
});
