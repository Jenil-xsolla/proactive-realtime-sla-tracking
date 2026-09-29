import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 300;
const VERSION_PREFIX = "v0=";

export type SlackVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_secret" | "missing_headers" | "bad_timestamp" | "stale" | "bad_signature";
    };

/**
 * Verifies Slack's request signature (design §3 step 1). Pure: takes the
 * secret and the clock explicitly, so it never reads process.env or calls
 * new Date() itself.
 */
export function verifySlackRequest(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  now: Date;
}): SlackVerifyResult {
  const { rawBody, timestamp, signature, secret, now } = input;

  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }
  if (timestamp === null || signature === null) {
    return { ok: false, reason: "missing_headers" };
  }

  if (!/^-?\d+$/.test(timestamp)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const ts = Number(timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected = VERSION_PREFIX + createHmac("sha256", secret).update(basestring).digest("hex");

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(signature);
  if (expectedBytes.length !== providedBytes.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(expectedBytes, providedBytes)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}
