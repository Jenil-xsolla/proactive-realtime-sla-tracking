const REQUEST_TIMEOUT_MS = 10_000;
const KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/** Fields the ingestion flow reads off the approved PIR issue. */
export const PIR_FIELDS = [
  "summary",
  "status",
  "created",
  "customfield_11646",
  "customfield_31331",
  "customfield_10399",
  "customfield_13920",
  "customfield_10250",
  "issuelinks",
];

/** Fields the ingestion flow reads off the PIR's linked incident issue. */
export const INCIDENT_FIELDS = ["customfield_10068", "created"];

export type JiraFetchResult = { ok: true; json: unknown } | { ok: false; error: string };

type Env = Record<string, string | undefined>;

/**
 * Fetches one Jira issue with a selected set of fields, using Basic auth
 * built from JIRA_EMAIL/JIRA_API_TOKEN. No retry: on failure the caller
 * records it. `env` is read fresh on every call, never captured at module
 * load, so tests (and future secret rotation) don't need a process restart.
 */
export async function fetchIssue(input: {
  key: string;
  fields: string[];
  fetch?: typeof fetch;
  env?: Env;
}): Promise<JiraFetchResult> {
  if (!KEY_PATTERN.test(input.key)) {
    return { ok: false, error: `Malformed Jira issue key: ${input.key}` };
  }

  const env = input.env ?? process.env;
  const doFetch = input.fetch ?? fetch;

  const baseUrl = env.JIRA_BASE_URL;
  if (!baseUrl || baseUrl.trim() === "") {
    return { ok: false, error: "Missing JIRA_BASE_URL" };
  }
  const email = env.JIRA_EMAIL;
  if (!email || email.trim() === "") {
    return { ok: false, error: "Missing JIRA_EMAIL" };
  }
  const token = env.JIRA_API_TOKEN;
  if (!token || token.trim() === "") {
    return { ok: false, error: "Missing JIRA_API_TOKEN" };
  }

  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const url = `${trimmedBase}/rest/api/3/issue/${encodeURIComponent(input.key)}?fields=${encodeURIComponent(
    input.fields.join(","),
  )}`;
  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const controller = new AbortController();
  const timeout = new Error("Jira request timed out");
  timeout.name = "TimeoutError";
  const timer = setTimeout(() => controller.abort(timeout), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await doFetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `Jira returned HTTP ${response.status} for ${input.key}` };
    }
    try {
      const json: unknown = await response.json();
      return { ok: true, json };
    } catch {
      return { ok: false, error: `Jira returned a non-JSON response for ${input.key}` };
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: "Jira request timed out" };
    }
    return { ok: false, error: `Jira request failed for ${input.key}` };
  } finally {
    clearTimeout(timer);
  }
}
