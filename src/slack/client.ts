/**
 * The one Slack Web API caller for the whole app. Alerting and ingestion both
 * go through here so there is exactly one place that knows how to retry,
 * time out and read a Slack response body.
 *
 * POST https://slack.com/api/${method} — for example
 * https://slack.com/api/chat.postMessage, https://slack.com/api/chat.update
 * and https://slack.com/api/views.open.
 */
const SLACK_API_BASE = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 10_000;
const VIEWS_OPEN_TIMEOUT_MS = 2_500;
const RETRY_AFTER_CAP_MS = 2_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export type SlackApiResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

type Attempt =
  | { kind: "delivered"; data: Record<string, unknown> }
  | { kind: "rejected"; error: string }
  | { kind: "rate_limited"; waitMs: number };

type CallSlackInput = {
  method: string;
  token: string;
  body: Record<string, unknown>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * Slack returns HTTP 200 for a failed Web API call. Delivery is ok: true in
 * the body. Anything else, including a timeout, is not delivered. One 429
 * is retried once, after waiting on a capped Retry-After.
 */
export async function callSlack(input: CallSlackInput): Promise<SlackApiResult> {
  const doFetch = input.fetch ?? fetch;
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const first = await attempt(doFetch, input, now, timeoutMs);
  if (first.kind !== "rate_limited") {
    return finish(first);
  }
  await sleep(first.waitMs);
  const second = await attempt(doFetch, input, now, timeoutMs);
  if (second.kind === "rate_limited") {
    return { ok: false, error: "Slack rate limited the send (HTTP 429) after one retry." };
  }
  return finish(second);
}

async function attempt(
  doFetch: typeof fetch,
  input: { method: string; token: string; body: Record<string, unknown> },
  now: () => number,
  timeoutMs: number,
): Promise<Attempt> {
  const controller = new AbortController();
  const timeout = new Error("Slack request timed out");
  timeout.name = "TimeoutError";
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
  timer.unref?.();
  try {
    const response = await doFetch(`${SLACK_API_BASE}/${input.method}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (response.status === 429) {
      return {
        kind: "rate_limited",
        waitMs: Math.min(retryAfterMs(response.headers.get("retry-after"), now()), RETRY_AFTER_CAP_MS),
      };
    }
    return classify(response);
  } catch (error) {
    return { kind: "rejected", error: describeFetchError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function classify(response: Response): Promise<Attempt> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok && isRecord(payload) && payload.ok === true) {
    return { kind: "delivered", data: payload };
  }
  if (isRecord(payload) && payload.ok === false) {
    const error = typeof payload.error === "string" && payload.error.trim() !== "" ? payload.error : "ok: false";
    return { kind: "rejected", error: explainSlackError(error) };
  }
  return { kind: "rejected", error: `Slack returned HTTP ${response.status} without ok: true.` };
}

function finish(attemptResult: Attempt): SlackApiResult {
  if (attemptResult.kind === "delivered") {
    return { ok: true, data: attemptResult.data };
  }
  if (attemptResult.kind === "rejected") {
    return { ok: false, error: attemptResult.error };
  }
  return { ok: false, error: "Slack rate limited the send (HTTP 429) after one retry." };
}

function explainSlackError(error: string): string {
  if (error === "not_in_channel") {
    return "not_in_channel: the bot is not a member of this channel. Invite it, then the next run will retry. The bot needs the chat:write scope.";
  }
  if (error === "channel_not_found") {
    return "channel_not_found: Slack has no channel with this id.";
  }
  if (error === "invalid_auth") {
    return "invalid_auth: Slack rejected SLACK_BOT_TOKEN. The bot needs the chat:write scope.";
  }
  return error;
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Slack request timed out before delivery could be confirmed.";
  }
  return "Slack request failed before delivery could be confirmed.";
}

function retryAfterMs(header: string | null, now: number): number {
  if (header === null || header.trim() === "") {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    return Math.max(0, when - now);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type Injectable = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type PostMessageResult =
  | { ok: true; ts: string; channel: string }
  | { ok: false; error: string };

/** `chat.postMessage`. An ok response missing `ts` is treated as not delivered. */
export async function postMessage(
  input: Injectable & {
    token: string;
    channel: string;
    text: string;
    blocks?: unknown[];
  },
): Promise<PostMessageResult> {
  const body: Record<string, unknown> = { channel: input.channel, text: input.text };
  if (input.blocks !== undefined) {
    body.blocks = input.blocks;
  }
  const result = await callSlack({
    method: "chat.postMessage",
    token: input.token,
    body,
    fetch: input.fetch,
    sleep: input.sleep,
    now: input.now,
  });
  if (!result.ok) {
    return result;
  }
  const ts = result.data.ts;
  if (typeof ts !== "string" || ts.trim() === "") {
    return { ok: false, error: "Slack accepted chat.postMessage but did not return a message ts." };
  }
  const channel = result.data.channel;
  return { ok: true, ts, channel: typeof channel === "string" && channel.trim() !== "" ? channel : input.channel };
}

export type UpdateMessageResult = { ok: true } | { ok: false; error: string };

/** `chat.update`: edits a previously posted message in place. */
export async function updateMessage(
  input: Injectable & {
    token: string;
    channel: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  },
): Promise<UpdateMessageResult> {
  const body: Record<string, unknown> = { channel: input.channel, ts: input.ts, text: input.text };
  if (input.blocks !== undefined) {
    body.blocks = input.blocks;
  }
  const result = await callSlack({
    method: "chat.update",
    token: input.token,
    body,
    fetch: input.fetch,
    sleep: input.sleep,
    now: input.now,
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true };
}

export type OpenViewResult = { ok: true } | { ok: false; error: string };

/**
 * `views.open`: opens a modal in response to a Slack interaction. Slack
 * requires the interaction to be acknowledged within 3s, so this uses a
 * tighter timeout than the default.
 */
export async function openView(
  input: Injectable & {
    token: string;
    triggerId: string;
    view: unknown;
  },
): Promise<OpenViewResult> {
  const result = await callSlack({
    method: "views.open",
    token: input.token,
    body: { trigger_id: input.triggerId, view: input.view },
    fetch: input.fetch,
    sleep: input.sleep,
    now: input.now,
    timeoutMs: VIEWS_OPEN_TIMEOUT_MS,
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true };
}
