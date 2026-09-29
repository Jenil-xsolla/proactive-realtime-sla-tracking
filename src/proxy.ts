import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPathAllowed, readServiceRole } from "@/service-role";

// No `config.matcher` is exported on purpose: Next's docs for proxy.js say
// that without a matcher, Proxy runs on every request, including
// `_next/static`, `_next/image` and `public/` assets. Deny-by-default means
// those must be reachable by the ingestion role's deny check too (spec: "not
// even /_next"), so the absence of a matcher is what gives full coverage —
// adding one back risks carving out an exclusion.

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Deny-by-default routing per `SERVICE_ROLE`. Reads the role once per
 * request (Proxy runs on the Node.js runtime by default in Next 16, so
 * `process.env` is fully readable here). An invalid or missing role fails
 * closed — 404, same as a disallowed path — rather than throwing, since a
 * throw here would surface as a 500 instead of denying the request.
 */
export function proxy(request: NextRequest): NextResponse {
  let role;
  try {
    role = readServiceRole(process.env);
  } catch {
    return notFound();
  }

  if (!isPathAllowed(role, request.nextUrl.pathname)) {
    return notFound();
  }

  return NextResponse.next();
}
