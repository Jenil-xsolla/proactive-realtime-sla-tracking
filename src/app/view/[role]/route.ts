import { VIEW_COOKIE } from "@/feed";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ONE_YEAR_SECONDS = 31536000;
const ENGINEER_ONLY = [/^\/alerts(\/|$)/, /^\/health(\/|$)/, /^\/partners\/[^/]+\/terms(\/|$)/];
/** A same-site path: one leading slash, never "//" or "/\" (browsers read those as another host). */
const LOCAL_PATH = /^\/(?![/\\])/;

/**
 * Sets the viewer-preference cookie and returns to the page the toggle was on.
 * Business has no alerts, health, or terms page, so those targets fall back to the overview.
 */
export async function GET(request: Request, context: { params: Promise<{ role: string }> }): Promise<Response> {
  const { role } = await context.params;
  if (role !== "technical" && role !== "business") {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const origin = requestOrigin(request);
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: target(request, role, origin),
      "Set-Cookie": `${VIEW_COOKIE}=${role}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax; HttpOnly${secure}`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The origin the viewer used. Behind a TLS-terminating proxy request.url can
 * carry http or an internal host, so the forwarded headers win when present.
 */
function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = first(request.headers.get("x-forwarded-proto"));
  const forwardedHost = first(request.headers.get("x-forwarded-host"));
  if (proto === null && forwardedHost === null) {
    return url.origin;
  }
  const host = forwardedHost ?? first(request.headers.get("host")) ?? url.host;
  return `${proto ?? url.protocol.replace(":", "")}://${host}`;
}

function first(value: string | null): string | null {
  const head = value?.split(",")[0]?.trim();
  return head === undefined || head === "" ? null : head;
}

function target(request: Request, role: "technical" | "business", origin: string): string {
  const referer = request.headers.get("referer");
  if (referer === null) {
    return "/";
  }
  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return "/";
  }
  if (from.origin !== origin) {
    return "/";
  }
  if (!LOCAL_PATH.test(from.pathname)) {
    return "/";
  }
  if (role === "business" && ENGINEER_ONLY.some((pattern) => pattern.test(from.pathname))) {
    const window = from.searchParams.get("window");
    return window === null ? "/" : `/?window=${encodeURIComponent(window)}`;
  }
  return `${from.pathname}${from.search}`;
}
