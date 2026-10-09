export type ViewerRole = "business" | "technical" | "system";

export type Viewer = {
  role: ViewerRole;
};

/**
 * The only place a viewer is read. Today that is the VIEWER_ROLE env var.
 * A real session replaces the body of this function and nothing else.
 */
export function getViewer(): Viewer {
  const role = process.env.VIEWER_ROLE;
  if (role === "business" || role === "technical" || role === "system") {
    return { role };
  }
  throw new Error("VIEWER_ROLE must be business, technical, or system.");
}

/** The cookie the top-bar toggle sets. Read by the dashboard only; the API routes and the alert job use getViewer(). */
export const VIEW_COOKIE = "sla_view";

/**
 * A dashboard role in the cookie wins; anything else, including "system",
 * falls back to getViewer() and throws like it when VIEWER_ROLE is invalid.
 * A real session replaces the cookie value passed in here.
 */
export function resolveViewer(override: string | undefined): Viewer {
  if (override === "business" || override === "technical") {
    return { role: override };
  }
  return getViewer();
}
