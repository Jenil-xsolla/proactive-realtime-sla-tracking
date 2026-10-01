const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const SECRET_HEADER = "x-internal-secret";
const METADATA_TIMEOUT_MS = 3_000;
const ALERT_RUN_TIMEOUT_MS = 30_000;

export type TriggerAlertRunResult = { ok: true } | { ok: false; error: string };

type Env = Record<string, string | undefined>;

type TriggerAlertRunInput = {
  fetch?: typeof fetch;
  env?: Env;
};

/**
 * Called after a capture or correction (design: ingestion → dashboard's
 * internal alert route, over Direct VPC egress with a Cloud Run identity
 * token plus the existing shared secret). Cloud Scheduler calls the same
 * dashboard route directly on a schedule; alert logic has one owner.
 *
 * Never throws — the caller logs the result. env is read fresh on every
 * call rather than captured once, so a test (or a live redeploy) can change
 * it between calls.
 */
export async function triggerAlertRun(input: TriggerAlertRunInput = {}): Promise<TriggerAlertRunResult> {
  const doFetch = input.fetch ?? fetch;
  const env = input.env ?? process.env;

  const rawUrl = env.DASHBOARD_INTERNAL_URL;
  if (!rawUrl) {
    return { ok: false, error: "DASHBOARD_INTERNAL_URL is not set." };
  }
  const secret = env.INTERNAL_SHARED_SECRET;
  if (!secret) {
    return { ok: false, error: "INTERNAL_SHARED_SECRET is not set." };
  }

  const base = rawUrl.replace(/\/+$/, "");

  const tokenResult = await fetchIdentityToken(doFetch, base);
  if (!tokenResult.ok) {
    return tokenResult;
  }

  return await postAlertRun(doFetch, base, tokenResult.token, secret);
}

async function fetchIdentityToken(
  doFetch: typeof fetch,
  audience: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const url = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`;
  const controller = new AbortController();
  const timeout = new Error("Metadata server request timed out");
  timeout.name = "TimeoutError";
  const timer = setTimeout(() => controller.abort(timeout), METADATA_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await doFetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Metadata server returned HTTP ${response.status} while requesting an identity token.`,
      };
    }
    const token = (await response.text()).trim();
    if (token === "") {
      return { ok: false, error: "Metadata server returned an empty identity token." };
    }
    return { ok: true, token };
  } catch (error) {
    return { ok: false, error: describeFetchError(error, "Metadata server request") };
  } finally {
    clearTimeout(timer);
  }
}

async function postAlertRun(
  doFetch: typeof fetch,
  base: string,
  token: string,
  secret: string,
): Promise<TriggerAlertRunResult> {
  const controller = new AbortController();
  const timeout = new Error("Alert run request timed out");
  timeout.name = "TimeoutError";
  const timer = setTimeout(() => controller.abort(timeout), ALERT_RUN_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await doFetch(`${base}/api/internal/alerts/run`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        [SECRET_HEADER]: secret,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `Dashboard alert run returned HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, error: describeFetchError(error, "Alert run request") };
  } finally {
    clearTimeout(timer);
  }
}

/** Never includes the response body or request details, so it can never leak the token or the secret. */
function describeFetchError(error: unknown, what: string): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${what} timed out.`;
  }
  return `${what} failed before a response was received.`;
}
