import { callSlack } from "@/slack/client";

export type SlackPostResult = { ok: true } | { ok: false; error: string };

/**
 * Thin wrapper over the shared Slack Web API caller. Slack returns HTTP 200
 * for a failed chat.postMessage. Delivery is ok: true in the body. Anything
 * else, including a timeout, is not delivered.
 *
 * This intentionally calls callSlack rather than @/slack/client's own
 * postMessage: postMessage also requires a message ts in the response,
 * which alerting has never needed and must not start requiring.
 */
export async function postSlackMessage(input: {
  token: string;
  channel: string;
  text: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<SlackPostResult> {
  const result = await callSlack({
    method: "chat.postMessage",
    token: input.token,
    body: { channel: input.channel, text: input.text },
    fetch: input.fetch,
    sleep: input.sleep,
    now: input.now,
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true };
}
