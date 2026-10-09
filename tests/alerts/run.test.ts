import { afterEach, describe, expect, it } from "vitest";
import { createMemoryAlertStore, runAlerts, type AlertStateStore } from "@/alerts";
import {
  AS_OF,
  SCORED_KEY,
  SCORED_MERCHANT,
  SCORED_PIR,
  SCORED_REVIEWER,
  scoredRow,
  systemFeed,
  trackingRow,
} from "./fixtures";

const ENV_KEYS = [
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_LEGAL",
  "SLACK_CHANNEL_ENGINEER",
  "DATABASE_URL",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function slackEnv(): void {
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_CHANNEL_LEGAL = "legal-id";
  process.env.SLACK_CHANNEL_ENGINEER = "engineer-id";
}

function okFetch(calls: { body: string; channel?: string }[]): typeof fetch {
  return async (_url, init) => {
    const body = String(init?.body);
    calls.push({ body, channel: JSON.parse(body).channel as string });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
}

async function seed(
  store: AlertStateStore,
  key: { partnerSlug: string; scopeId: string; period: string },
  status: string,
): Promise<void> {
  await store.exclusive(key, async ({ commit }) => {
    await commit({ status, alerted: true, at: new Date("2026-09-01T00:00:00.000Z") });
  });
}

describe("runAlerts", () => {
  it("reports a feed failure instead of a zero-alert success", async () => {
    delete process.env.DATABASE_URL;
    const report = await runAlerts({
      asOf: AS_OF,
      state: createMemoryAlertStore(),
      loadFeed: async () => {
        throw new Error("connection refused");
      },
      fetch: async () => {
        throw new Error("Slack must not be called");
      },
    });

    expect(report).toMatchObject({
      scopesEvaluated: 0,
      transitionsFound: 0,
      alertsSent: 0,
      dryRun: false,
      planned: [],
    });
    expect(report.errors).toEqual(["Could not evaluate: connection refused"]);
  });

  it("completes quietly when the feed has no rows", async () => {
    const calls: { body: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: createMemoryAlertStore(),
      loadFeed: async () => systemFeed([]),
      fetch: okFetch(calls),
    });

    expect(report).toMatchObject({
      scopesEvaluated: 0,
      transitionsFound: 0,
      alertsSent: 0,
      errors: [],
      planned: [],
    });
    expect(calls).toHaveLength(0);
  });

  it("sends nothing and writes nothing when the status is unchanged", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "at_risk");
    const commits = store.commits;
    const calls: { body: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: okFetch(calls),
    });

    expect(report).toMatchObject({
      scopesEvaluated: 1,
      transitionsFound: 0,
      alertsSent: 0,
      errors: [],
      planned: [],
    });
    expect(calls).toHaveLength(0);
    expect(store.commits).toBe(commits);
    expect(store.read(SCORED_KEY)?.status).toBe("at_risk");
  });

  it("sends once on an upward transition and writes state only after Slack accepts it", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    const calls: { body: string; channel: string }[] = [];
    let statusDuringSend: string | null | undefined;
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: async (_url, init) => {
        statusDuringSend = store.read(SCORED_KEY)?.status ?? null;
        const body = String(init?.body);
        calls.push({ body, channel: JSON.parse(body).channel as string });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(statusDuringSend).toBe("meeting");
    expect(store.read(SCORED_KEY)?.status).toBe("at_risk");
    expect(report.transitionsFound).toBe(1);
    expect(report.alertsSent).toBe(2);
    expect(report.errors).toEqual([]);
    expect(calls.map((call) => call.channel).sort()).toEqual(["engineer-id", "legal-id"]);

    const legal = calls.find((call) => call.channel === "legal-id");
    const engineer = calls.find((call) => call.channel === "engineer-id");
    expect(legal).toBeDefined();
    expect(engineer).toBeDefined();
    expect(legal?.body).not.toContain(SCORED_PIR);
    expect(legal?.body).not.toContain(SCORED_MERCHANT);
    expect(legal?.body).not.toContain(SCORED_REVIEWER);
    expect(legal?.body).not.toContain("ai_approved");
    expect(legal?.body).toContain("25%");
    expect(legal?.body).not.toContain("10%");
    expect(legal?.body).toContain("*25%*");
    expect(legal?.body).not.toContain("**");
    expect(engineer?.body).toContain("*Rule*:");
    expect(engineer?.body).toContain("*Elapsed*:");
    expect(engineer?.body).toContain(`<https://jira.example/browse/${SCORED_PIR}|${SCORED_PIR}>`);
    expect(engineer?.body).not.toContain(SCORED_MERCHANT);
    expect(engineer?.body).not.toContain(SCORED_REVIEWER);
    expect(store.entries()[0]?.partnerSlug).toBe("scopely");
  });

  it("notifies Legal and Engineering on a breach, with ticket detail only on the engineer message", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "at_risk");
    const calls: { body: string; channel: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("breached")]),
      fetch: okFetch(calls),
    });

    expect(report.alertsSent).toBe(2);
    expect(report.errors).toEqual([]);
    expect(store.read(SCORED_KEY)?.status).toBe("breached");
    expect(calls.map((call) => call.channel).sort()).toEqual(["engineer-id", "legal-id"]);
    for (const call of calls.filter((item) => item.channel !== "engineer-id")) {
      expect(call.body).not.toContain(SCORED_PIR);
      expect(call.body).not.toContain(SCORED_MERCHANT);
      expect(call.body).not.toContain(SCORED_REVIEWER);
      expect(call.body).toContain("*25%*");
    }
    const engineer = calls.find((call) => call.channel === "engineer-id");
    expect(engineer?.body).toContain(SCORED_PIR);
  });

  it("downgrades a recovery without sending", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "at_risk");
    const alertCount = store.read(SCORED_KEY)?.alertCount;
    const calls: { body: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("meeting")]),
      fetch: okFetch(calls),
    });

    expect(calls).toHaveLength(0);
    expect(report.transitionsFound).toBe(0);
    expect(report.alertsSent).toBe(0);
    expect(report.planned).toEqual([]);
    expect(store.read(SCORED_KEY)?.status).toBe("meeting");
    expect(store.read(SCORED_KEY)?.alertCount).toBe(alertCount);
  });

  it("leaves state unchanged when Slack returns HTTP 200 with ok: false", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: async () => new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), { status: 200 }),
    });

    expect(store.read(SCORED_KEY)?.status).toBe("meeting");
    expect(report.alertsSent).toBe(0);
    expect(report.transitionsFound).toBe(1);
    expect(report.errors.join("\n")).toContain("not_in_channel");
    expect(report.errors.join("\n").toLowerCase()).toContain("invite");
  });

  it("leaves state unchanged when the send fails", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    });

    expect(store.read(SCORED_KEY)?.status).toBe("meeting");
    expect(report.alertsSent).toBe(0);
    expect(report.errors.join("\n").toLowerCase()).toContain("timed out");
  });

  it("leaves state unchanged when Slack keeps returning HTTP 429", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    let calls = 0;
    const sleeps: number[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
          status: 429,
          headers: { "retry-after": "30" },
        });
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(store.read(SCORED_KEY)?.status).toBe("meeting");
    expect(report.alertsSent).toBe(0);
    expect(report.errors.join("\n")).toContain("429");
  });

  it("lets two concurrent runs send one transition", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    let calls = 0;
    const run = () =>
      runAlerts({
        asOf: AS_OF,
        state: store,
        loadFeed: async () => systemFeed([scoredRow("at_risk")]),
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      });

    const [first, second] = await Promise.all([run(), run()]);

    expect(calls).toBe(2);
    expect(first.alertsSent + second.alertsSent).toBe(2);
    expect(first.transitionsFound + second.transitionsFound).toBe(1);
    expect(first.errors.concat(second.errors)).toEqual([]);
    expect(store.read(SCORED_KEY)?.status).toBe("at_risk");
  });

  it("returns the messages a dry run would send without writing or calling Slack", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    const preview = await runAlerts({
      asOf: AS_OF,
      dryRun: true,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: async () => {
        throw new Error("Slack must not be called");
      },
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.transitionsFound).toBe(1);
    expect(preview.alertsSent).toBe(0);
    expect(preview.errors).toEqual([]);
    expect(preview.planned.map((item) => item.audience)).toEqual(["legal", "engineer"]);
    expect(store.read(SCORED_KEY)?.status).toBe("meeting");

    const calls: { body: string }[] = [];
    const live = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: okFetch(calls),
    });

    expect(live.alertsSent).toBe(2);
    expect(calls.map((call) => JSON.parse(call.body).text as string)).toEqual(
      preview.planned.map((item) => item.text),
    );
  });

  it("does not send during an excluded maintenance window", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    await seed(store, SCORED_KEY, "meeting");
    const calls: { body: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      maintenance: [
        {
          partnerSlug: "scopely",
          scopeId: null,
          start: new Date("2026-09-01T00:00:00.000Z"),
          end: new Date("2026-10-01T00:00:00.000Z"),
        },
      ],
      loadFeed: async () => systemFeed([scoredRow("at_risk")]),
      fetch: okFetch(calls),
    });

    expect(calls).toHaveLength(0);
    expect(report.transitionsFound).toBe(0);
    expect(report.alertsSent).toBe(0);
    expect(store.read(SCORED_KEY)?.status).toBe("meeting");
  });
});

describe("tracking-only heads-up", () => {
  it("never fires when history is insufficient", async () => {
    slackEnv();
    const store = createMemoryAlertStore();
    const calls: { body: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () =>
        systemFeed([
          trackingRow({
            usedMinutes: 400,
            comparison: { kind: "insufficient_history", coveredMonths: 2, monthsWithDowntime: 1 },
          }),
        ]),
      fetch: okFetch(calls),
    });

    expect(report).toMatchObject({ scopesEvaluated: 1, transitionsFound: 0, alertsSent: 0, errors: [] });
    expect(calls).toHaveLength(0);
    expect(store.entries()).toEqual([]);
  });

  it("fires on first recorded downtime only above the absolute floor, to the engineer channel", async () => {
    slackEnv();
    const quiet = createMemoryAlertStore();
    const quietCalls: { body: string }[] = [];
    const held = await runAlerts({
      asOf: AS_OF,
      state: quiet,
      loadFeed: async () =>
        systemFeed([
          trackingRow({
            usedMinutes: 30,
            comparison: { kind: "no_prior_downtime", coveredMonths: 6, monthsWithDowntime: 0 },
          }),
        ]),
      fetch: okFetch(quietCalls),
    });
    expect(held.alertsSent).toBe(0);
    expect(quiet.entries()).toEqual([]);

    const store = createMemoryAlertStore();
    const calls: { body: string; channel: string }[] = [];
    const report = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () =>
        systemFeed([
          trackingRow({
            usedMinutes: 31,
            comparison: { kind: "no_prior_downtime", coveredMonths: 6, monthsWithDowntime: 0 },
          }),
        ]),
      fetch: okFetch(calls),
    });

    expect(report.alertsSent).toBe(1);
    expect(report.errors).toEqual([]);
    expect(calls.map((call) => call.channel)).toEqual(["engineer-id"]);
    const body = calls[0]?.body ?? "";
    expect(body).toContain("First recorded downtime in the last 6 covered months");
    expect(body).toContain("31 min");
    expect(body).toContain("<https://jira.example/browse/GTO-100|GTO-100>");
    expect(body.toLowerCase()).not.toMatch(/\b(target|breach\w*|sla|compliance|unusual)\b/);
    expect(body).not.toContain("506855");
    expect(body).not.toContain("quinn.chen");
    expect(store.entries()).toEqual([
      expect.objectContaining({
        partnerSlug: "second-dinner",
        scopeId: "tracking:payments",
        period: "2026-09",
        status: "heads_up",
      }),
    ]);

    const again = await runAlerts({
      asOf: AS_OF,
      state: store,
      loadFeed: async () =>
        systemFeed([
          trackingRow({
            usedMinutes: 31,
            comparison: { kind: "no_prior_downtime", coveredMonths: 6, monthsWithDowntime: 0 },
          }),
        ]),
      fetch: okFetch(calls),
    });
    expect(again.alertsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("fires a compared month only when both the ratio and the absolute margin clear", async () => {
    slackEnv();
    const notNews = await sendTracking({
      usedMinutes: 5,
      comparison: {
        kind: "compared",
        coveredMonths: 6,
        monthsWithDowntime: 3,
        medianMinutes: 2,
        currentMinutes: 5,
        versusMedian: "above",
      },
    });
    expect(notNews.calls).toHaveLength(0);

    const marginOnly = await sendTracking({
      usedMinutes: 120,
      comparison: {
        kind: "compared",
        coveredMonths: 6,
        monthsWithDowntime: 6,
        medianMinutes: 100,
        currentMinutes: 120,
        versusMedian: "above",
      },
    });
    expect(marginOnly.calls).toHaveLength(0);

    const sent = await sendTracking({
      usedMinutes: 60,
      comparison: {
        kind: "compared",
        coveredMonths: 6,
        monthsWithDowntime: 4,
        medianMinutes: 20,
        currentMinutes: 60,
        versusMedian: "above",
      },
    });
    expect(sent.report.alertsSent).toBe(1);
    expect(sent.calls.map((call) => call.channel)).toEqual(["engineer-id"]);
    const body = sent.calls[0]?.body ?? "";
    expect(body).toContain("60 min");
    expect(body).toContain("20 min");
    expect(body).toContain("prior-month median");
    expect(body).toContain("<https://jira.example/browse/GTO-100|GTO-100>");
    expect(body.toLowerCase()).not.toMatch(/\b(target|breach\w*|sla|compliance)\b/);
    expect(body).not.toContain("506855");
    expect(body).not.toContain("quinn.chen");
  });
});

async function sendTracking(input: {
  usedMinutes: number;
  comparison: Extract<ReturnType<typeof trackingRow>, { kind: "tracking_only" }>["comparison"];
}): Promise<{ report: Awaited<ReturnType<typeof runAlerts>>; calls: { body: string; channel: string }[] }> {
  const calls: { body: string; channel: string }[] = [];
  const report = await runAlerts({
    asOf: AS_OF,
    state: createMemoryAlertStore(),
    loadFeed: async () => systemFeed([trackingRow(input)]),
    fetch: okFetch(calls),
  });
  return { report, calls };
}
