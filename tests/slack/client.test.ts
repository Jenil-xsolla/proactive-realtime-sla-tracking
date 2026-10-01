import { describe, expect, it, vi } from "vitest";
import { callSlack, openView, postMessage, updateMessage } from "@/slack/client";

const TOKEN = "xoxb-test-token";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("callSlack", () => {
  it("posts to https://slack.com/api/<method> with the bearer token and no-store", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await callSlack({
      method: "chat.postMessage",
      token: TOKEN,
      body: { channel: "C1", text: "hi" },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({ ok: true, ts: "1" });
      },
    });

    expect(result).toEqual({ ok: true, data: { ok: true, ts: "1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(String(calls[0]?.init.body)).not.toContain(TOKEN);
  });

  it("retries HTTP 429 once, waiting on Retry-After, then accepts ok: true", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await callSlack({
      method: "chat.update",
      token: TOKEN,
      body: { channel: "C1", ts: "1", text: "hi" },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ ok: false, error: "ratelimited" }, 429, { "retry-after": "1" });
        }
        return jsonResponse({ ok: true });
      },
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it("gives up after one retry and never leaks the token in the error", async () => {
    const result = await callSlack({
      method: "chat.postMessage",
      token: TOKEN,
      body: { channel: "C1", text: "hi" },
      sleep: async () => {},
      fetch: async () => jsonResponse({ ok: false, error: "ratelimited" }, 429, { "retry-after": "30" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("429");
      expect(result.error).not.toContain(TOKEN);
    }
  });

  it("never lets the token reach the error text on a rejected request", async () => {
    const result = await callSlack({
      method: "chat.postMessage",
      token: TOKEN,
      body: { channel: "C1", text: "hi" },
      fetch: async () => {
        throw new Error(`network exploded near token ${TOKEN}`);
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(TOKEN);
    }
  });
});

describe("postMessage", () => {
  it("returns the message ts and channel on success", async () => {
    const result = await postMessage({
      token: TOKEN,
      channel: "C1",
      text: "hello",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          channel: "C1",
          text: "hello",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
        });
        return jsonResponse({ ok: true, ts: "1700000000.000100", channel: "C1" });
      },
    });

    expect(result).toEqual({ ok: true, ts: "1700000000.000100", channel: "C1" });
  });

  it("omits blocks from the request body when none are given", async () => {
    const result = await postMessage({
      token: TOKEN,
      channel: "C1",
      text: "hello",
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ channel: "C1", text: "hello" });
        return jsonResponse({ ok: true, ts: "1" });
      },
    });

    expect(result.ok).toBe(true);
  });

  it("treats an ok response missing ts as not delivered", async () => {
    const result = await postMessage({
      token: TOKEN,
      channel: "C1",
      text: "hello",
      fetch: async () => jsonResponse({ ok: true }),
    });

    expect(result.ok).toBe(false);
  });

  it("returns the Slack error when chat.postMessage reports ok: false", async () => {
    const result = await postMessage({
      token: TOKEN,
      channel: "C1",
      text: "hello",
      fetch: async () => jsonResponse({ ok: false, error: "channel_not_found" }),
    });

    expect(result).toEqual({ ok: false, error: "channel_not_found: Slack has no channel with this id." });
  });

  it("explains not_in_channel neutrally — a capture message is one-shot, so it must not claim a retry will happen on its own", async () => {
    const result = await postMessage({
      token: TOKEN,
      channel: "C1",
      text: "hello",
      fetch: async () => jsonResponse({ ok: false, error: "not_in_channel" }),
    });

    expect(result).toEqual({
      ok: false,
      error:
        "not_in_channel: the bot is not a member of this channel. Invite it, then retry. The bot needs the chat:write scope.",
    });
  });
});

describe("updateMessage", () => {
  it("edits a message in place", async () => {
    const result = await updateMessage({
      token: TOKEN,
      channel: "C1",
      ts: "1700000000.000100",
      text: "updated",
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          channel: "C1",
          ts: "1700000000.000100",
          text: "updated",
        });
        return jsonResponse({ ok: true });
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns the error when chat.update reports ok: false", async () => {
    const result = await updateMessage({
      token: TOKEN,
      channel: "C1",
      ts: "1",
      text: "updated",
      fetch: async () => jsonResponse({ ok: false, error: "message_not_found" }),
    });

    expect(result).toEqual({ ok: false, error: "message_not_found" });
  });
});

describe("openView", () => {
  it("opens a modal with the trigger id and view payload", async () => {
    const result = await openView({
      token: TOKEN,
      triggerId: "T1",
      view: { type: "modal" },
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ trigger_id: "T1", view: { type: "modal" } });
        return jsonResponse({ ok: true });
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns the error when views.open reports ok: false", async () => {
    const result = await openView({
      token: TOKEN,
      triggerId: "T1",
      view: { type: "modal" },
      fetch: async () => jsonResponse({ ok: false, error: "invalid_trigger_id" }),
    });

    expect(result).toEqual({ ok: false, error: "invalid_trigger_id" });
  });

  it("times out at 2.5s so the 3s Slack interaction window holds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock: typeof fetch = (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });

      const promise = openView({ token: TOKEN, triggerId: "T1", view: {}, fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(2500);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain("timed out");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
