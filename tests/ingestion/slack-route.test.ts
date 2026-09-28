import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const handleSlackInteraction = vi.fn();
const defaultInteractionDeps = vi.fn();
const afterMock = vi.fn();

vi.mock("@/ingestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ingestion")>();
  return {
    ...actual,
    handleSlackInteraction: (...args: unknown[]) => handleSlackInteraction(...args),
    defaultInteractionDeps: (...args: unknown[]) => defaultInteractionDeps(...args),
  };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => Promise<void>) => afterMock(fn),
  };
});

import * as route from "@/app/api/slack/interactions/route";

const originalSecret = process.env.SLACK_SIGNING_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.SLACK_SIGNING_SECRET;
  } else {
    process.env.SLACK_SIGNING_SECRET = originalSecret;
  }
  vi.clearAllMocks();
});

function sign(secret: string, timestamp: string, rawBody: string): string {
  const basestring = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", secret).update(basestring).digest("hex")}`;
}

function currentTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function post(options: { rawBody: string; timestamp?: string; signature?: string; noHeaders?: boolean }): Promise<Response> {
  const headers = new Headers();
  if (!options.noHeaders) {
    if (options.timestamp !== undefined) {
      headers.set("x-slack-request-timestamp", options.timestamp);
    }
    if (options.signature !== undefined) {
      headers.set("x-slack-signature", options.signature);
    }
  }
  return route.POST(
    new Request("http://localhost/api/slack/interactions", {
      method: "POST",
      headers,
      body: options.rawBody,
    }),
  );
}

describe("POST /api/slack/interactions module shape", () => {
  it("exports exactly POST, dynamic and fetchCache", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic", "fetchCache"]);
  });
});

describe("POST /api/slack/interactions", () => {
  it("rejects a request with a bad signature", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "shortcut" }));
    const timestamp = currentTimestamp();

    const response = await post({ rawBody, timestamp, signature: "v0=deadbeef" });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature headers at all", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "shortcut" }));

    const response = await post({ rawBody, noHeaders: true });

    expect(response.status).toBe(401);
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("accepts a request with a correctly computed signature, and passes the parsed payload through", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const deps = {};
    defaultInteractionDeps.mockReturnValue(deps);
    handleSlackInteraction.mockResolvedValue({ body: null });

    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "shortcut" }));
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(200);
    expect(handleSlackInteraction).toHaveBeenCalledTimes(1);
    expect(handleSlackInteraction).toHaveBeenCalledWith({ type: "shortcut" }, deps);
  });

  it("rejects a request whose signature was computed over a different encoding of the body than was sent", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const signedBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "shortcut" }));
    const sentBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "view_submission" }));
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, signedBody);

    const response = await post({ rawBody: sentBody, timestamp, signature });

    expect(response.status).toBe(401);
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("returns 400 when the payload field is missing", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const rawBody = "not_payload=1";
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(400);
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("returns 400 when the payload field is not valid JSON", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const rawBody = "payload=" + encodeURIComponent("{not json");
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(400);
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("returns 500 when defaultInteractionDeps throws, without leaking the message", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    defaultInteractionDeps.mockImplementation(() => {
      throw new Error("SLACK_BOT_TOKEN is required");
    });

    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "shortcut" }));
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "ingestion is not configured" });
    expect(handleSlackInteraction).not.toHaveBeenCalled();
  });

  it("a submission's JSON body is returned and its followUp is registered through after()", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    const deps = {};
    defaultInteractionDeps.mockReturnValue(deps);
    const followUp = vi.fn().mockResolvedValue(undefined);
    handleSlackInteraction.mockResolvedValue({ body: { response_action: "clear" }, followUp });

    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "view_submission" }));
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ response_action: "clear" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledWith(followUp);
  });

  it("returns an empty 200 when the handler's body is null, and does not call after() without a followUp", async () => {
    process.env.SLACK_SIGNING_SECRET = "shh";
    defaultInteractionDeps.mockReturnValue({});
    handleSlackInteraction.mockResolvedValue({ body: null });

    const rawBody = "payload=" + encodeURIComponent(JSON.stringify({ type: "block_actions" }));
    const timestamp = currentTimestamp();
    const signature = sign("shh", timestamp, rawBody);

    const response = await post({ rawBody, timestamp, signature });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(afterMock).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toBe("");
  });
});
