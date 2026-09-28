import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import { defaultPirDeps, handlePirApproved } from "@/ingestion";
import { secretMatches } from "@/app/api/shared-secret";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const SECRET_HEADER = "jira-webhook-token";

/**
 * Jira Automation webhook (spec §2 step 1): posts `{ issueKey }` with a
 * shared-secret header on every PIR approval, including a redelivery.
 * Jira Automation does not retry, so every outcome — including `failed`
 * and `receipt_failed` — gets a 200 (spec §2 "On failure at any step");
 * the error itself is recorded by `handlePirApproved`, not surfaced here.
 */
export async function POST(request: Request) {
  noStore();

  if (!secretMatches(request.headers.get(SECRET_HEADER), process.env.JIRA_WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ error: "Request body must be a JSON object with an issueKey." }, 400);
  }

  const rawIssueKey = (body as { issueKey?: unknown }).issueKey;
  if (typeof rawIssueKey !== "string") {
    return json({ error: "issueKey is required." }, 400);
  }
  const issueKey = rawIssueKey.trim();
  if (issueKey === "") {
    return json({ error: "issueKey is required." }, 400);
  }

  let deps;
  try {
    deps = defaultPirDeps();
  } catch (error) {
    console.error(`defaultPirDeps failed: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "ingestion is not configured" }, 500);
  }

  const outcome = await handlePirApproved(issueKey, deps);
  return json({ issueKey, outcome: outcome.kind }, 200);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
