import { timingSafeEqual } from "node:crypto";
import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import { parseAlertRunRequest, runAlerts, type AlertRunReport } from "@/alerts";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const SECRET_HEADER = "x-internal-secret";

/**
 * Called in two ways: by Cloud Scheduler at 01:00 and 13:00 UTC, and by the
 * ingestion service after every capture or correction. Each call is one
 * evaluation pass. Callers hold no alert logic.
 */
export async function POST(request: Request) {
  noStore();
  if (!sharedSecretMatches(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = parseAlertRunRequest(await request.text());
  if ("error" in parsed) {
    return json(
      {
        scopesEvaluated: 0,
        transitionsFound: 0,
        alertsSent: 0,
        errors: [parsed.error],
        dryRun: false,
        planned: [],
      },
      400,
    );
  }

  const report = await runAlerts({ asOf: new Date(), dryRun: parsed.dryRun });
  const status = report.errors.some((error) => error.startsWith("Could not evaluate")) ? 500 : 200;
  return json(report, status);
}

function json(body: AlertRunReport, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Checked here, on every request. Placement on a private network is not access control. */
function sharedSecretMatches(request: Request): boolean {
  const expected = process.env.INTERNAL_SHARED_SECRET;
  const provided = request.headers.get(SECRET_HEADER);
  if (!expected || provided === null) {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}
