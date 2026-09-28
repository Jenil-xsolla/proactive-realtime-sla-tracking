import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackRequest } from "@/ingestion";

const SECRET = "8f742231b10e8888abcd99yyyzz85a5";
const RAW_BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&channel_id=C2147483705";

function sign(secret: string, timestamp: string, rawBody: string): string {
  const basestring = `v0:${timestamp}:${rawBody}`;
  return "v0=" + createHmac("sha256", secret).update(basestring).digest("hex");
}

function nowSeconds(now: Date): string {
  return String(Math.floor(now.getTime() / 1000));
}

describe("verifySlackRequest", () => {
  const now = new Date("2026-09-28T10:00:00.000Z");

  it("accepts a valid signature at the current timestamp", () => {
    const timestamp = nowSeconds(now);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature, secret: SECRET, now });

    expect(result).toEqual({ ok: true });
  });

  it("rejects a timestamp 301 seconds in the past as stale", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 301);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature, secret: SECRET, now });

    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts a timestamp exactly 300 seconds in the past", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 300);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature, secret: SECRET, now });

    expect(result).toEqual({ ok: true });
  });

  it("rejects a timestamp 301 seconds in the future as stale", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) + 301);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature, secret: SECRET, now });

    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a tampered body", () => {
    const timestamp = nowSeconds(now);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({
      rawBody: RAW_BODY + "&tampered=1",
      timestamp,
      signature,
      secret: SECRET,
      now,
    });

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered signature of the same length", () => {
    const timestamp = nowSeconds(now);
    const signature = sign(SECRET, timestamp, RAW_BODY);
    const lastChar = signature.at(-1);
    const flipped = lastChar === "0" ? "1" : "0";
    const tampered = signature.slice(0, -1) + flipped;

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature: tampered, secret: SECRET, now });

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a wrong-length signature", () => {
    const timestamp = nowSeconds(now);

    const result = verifySlackRequest({
      rawBody: RAW_BODY,
      timestamp,
      signature: "v0=short",
      secret: SECRET,
      now,
    });

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects when the secret is missing", () => {
    const timestamp = nowSeconds(now);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature, secret: undefined, now });

    expect(result).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("rejects a missing timestamp header", () => {
    const timestamp = nowSeconds(now);
    const signature = sign(SECRET, timestamp, RAW_BODY);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp: null, signature, secret: SECRET, now });

    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects a missing signature header", () => {
    const timestamp = nowSeconds(now);

    const result = verifySlackRequest({ rawBody: RAW_BODY, timestamp, signature: null, secret: SECRET, now });

    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects a non-numeric timestamp", () => {
    const signature = sign(SECRET, "not-a-number", RAW_BODY);

    const result = verifySlackRequest({
      rawBody: RAW_BODY,
      timestamp: "not-a-number",
      signature,
      secret: SECRET,
      now,
    });

    expect(result).toEqual({ ok: false, reason: "bad_timestamp" });
  });
});
