/**
 * `SERVICE_ROLE` selects which half of the app a Cloud Run service answers
 * for: one image is deployed twice, `sla-dashboard` (internal ingress) and
 * `sla-ingestion` (public ingress). Deny-by-default: an unrecognised or
 * missing value must stop the app rather than default to either role, since
 * defaulting to `dashboard` would silently make the dashboard public behind
 * `sla-ingestion`'s public ingress.
 *
 * Pure and unit-tested directly; `src/proxy.ts` and `src/instrumentation.ts`
 * are the only callers.
 */
export type ServiceRole = "dashboard" | "ingestion";

/**
 * Exact-match on purpose: no trimming, no case folding. `"Dashboard "` is not
 * `"dashboard"` and must throw, not silently coerce into a role.
 */
export function readServiceRole(env: Record<string, string | undefined>): ServiceRole {
  const role = env.SERVICE_ROLE;
  if (role === "dashboard" || role === "ingestion") {
    return role;
  }
  throw new Error(`SERVICE_ROLE must be 'dashboard' or 'ingestion', got ${JSON.stringify(role)}`);
}

/**
 * The two paths `sla-ingestion` serves. Everything else belongs to
 * `sla-dashboard`. Kept here, not duplicated in `proxy.ts`, so the allow list
 * has one owner.
 */
const INGESTION_PATHS = ["/api/ingest/pir-approved", "/api/slack/interactions"] as const;

/** Strips a single trailing slash, but never collapses "/" itself. */
function withoutTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * `ingestion` allows exactly its two paths (a trailing slash tolerated) and
 * nothing else — not `/_next/*`, not a sub-path below either of them.
 * `dashboard` allows everything except those two paths and anything nested
 * under them, so it denies `/api/ingest/pir-approved/anything` too.
 */
export function isPathAllowed(role: ServiceRole, pathname: string): boolean {
  const normalized = withoutTrailingSlash(pathname);

  if (role === "ingestion") {
    return (INGESTION_PATHS as readonly string[]).includes(normalized);
  }

  return !INGESTION_PATHS.some(
    (ingestionPath) => normalized === ingestionPath || normalized.startsWith(`${ingestionPath}/`),
  );
}
