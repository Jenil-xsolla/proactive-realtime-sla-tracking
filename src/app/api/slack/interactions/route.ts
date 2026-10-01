import { unstable_noStore as noStore } from "next/cache";
import { NextResponse, after } from "next/server";
import { runSlackInteraction, verifySlackRequest } from "@/ingestion";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Slack's Interactivity Request URL (spec §3 "Handling a correction"): the
 * Correct button's `block_actions` click and the correction modal's
 * `view_submission`. Reads the raw body exactly once (Slack's signature
 * covers the raw bytes, not the parsed form), verifies it, then parses the
 * `payload` form field.
 *
 * `sla-ingestion` runs with CPU always allocated and minimum instances 1,
 * so `after()` here is safe: it responds within Slack's 3s window first,
 * then runs `chat.update` and the alert trigger in the background.
 */
export async function POST(request: Request) {
  noStore();

  const rawBody = await request.text();

  const verifyResult = verifySlackRequest({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    secret: process.env.SLACK_SIGNING_SECRET,
    now: new Date(),
  });
  if (!verifyResult.ok) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    const raw = new URLSearchParams(rawBody).get("payload");
    if (raw === null) {
      return json({ error: "Missing payload." }, 400);
    }
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "payload must be JSON." }, 400);
  }

  let result;
  try {
    result = await runSlackInteraction(payload);
  } catch (error) {
    console.error(`runSlackInteraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "ingestion is not configured" }, 500);
  }

  if (result.followUp) {
    after(result.followUp);
  }

  if (result.body === null) {
    return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  return json(result.body, 200);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
