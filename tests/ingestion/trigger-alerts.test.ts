import { describe, expect, it, vi } from "vitest";
import { triggerAlertRun } from "@/ingestion";

const DASHBOARD_URL = "https://sla-dashboard.internal.example.com";
const SECRET = "sh4red-s3cret-value";
const TOKEN = "identity-token-abc.def.ghi";

function baseEnv(): Record<string, string | undefined> {
  return {
    DASHBOARD_INTERNAL_URL: DASHBOARD_URL,
    INTERNAL_SHARED_SECRET: SECRET,
  };
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

type Call = { url: string; init: RequestInit };

function fetchSequence(responders: ((call: Call) => Response | Promise<Response>)[]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const responder = responders[calls.length - 1];
    if (!responder) {
      throw new Error(`Unexpected extra fetch call: ${call.url}`);
    }
    return responder(call);
  };
  return { fetch: fetchMock as typeof fetch, calls };
}

describe("triggerAlertRun", () => {
  it("requests an identity token for the dashboard audience, then posts with both headers", async () => {
    const { fetch, calls } = fetchSequence([
      () => textResponse(TOKEN),
      () => textResponse("{}", 200),
    ]);

    const result = await triggerAlertRun({ fetch, env: baseEnv() });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);

    const metadataCall = calls[0];
    expect(metadataCall?.url).toBe(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(DASHBOARD_URL)}`,
    );
    expect(new Headers(metadataCall?.init.headers).get("metadata-flavor")).toBe("Google");

    const alertCall = calls[1];
    expect(alertCall?.url).toBe(`${DASHBOARD_URL}/api/internal/alerts/run`);
    expect(alertCall?.init.method).toBe("POST");
    expect(alertCall?.init.cache).toBe("no-store");
    const headers = new Headers(alertCall?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("x-internal-secret")).toBe(SECRET);
    expect(headers.get("content-type")).toBe("application/json");
    expect(alertCall?.init.body).toBe("{}");
  });

  it("trims a trailing slash from DASHBOARD_INTERNAL_URL before building the audience and the request URL", async () => {
    const { fetch, calls } = fetchSequence([
      () => textResponse(TOKEN),
      () => textResponse("{}", 200),
    ]);

    const result = await triggerAlertRun({
      fetch,
      env: { DASHBOARD_INTERNAL_URL: `${DASHBOARD_URL}/`, INTERNAL_SHARED_SECRET: SECRET },
    });

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(DASHBOARD_URL)}`,
    );
    expect(calls[1]?.url).toBe(`${DASHBOARD_URL}/api/internal/alerts/run`);
  });

  it("does not call the dashboard when the metadata server responds with a non-2xx status", async () => {
    const { fetch, calls } = fetchSequence([() => textResponse("forbidden", 403)]);

    const result = await triggerAlertRun({ fetch, env: baseEnv() });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("does not call the dashboard when the metadata server returns an empty body", async () => {
    const { fetch, calls } = fetchSequence([() => textResponse("", 200)]);

    const result = await triggerAlertRun({ fetch, env: baseEnv() });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("does not call the dashboard when the metadata request fails on the network", async () => {
    const calls: Call[] = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      throw new Error("network down");
    };

    const result = await triggerAlertRun({ fetch: fetchMock as typeof fetch, env: baseEnv() });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("returns ok: false with the status when the dashboard returns HTTP 500", async () => {
    const { fetch } = fetchSequence([
      () => textResponse(TOKEN),
      () =>
        new Response(
          JSON.stringify({
            scopesEvaluated: 0,
            transitionsFound: 0,
            alertsSent: 0,
            errors: ["Could not evaluate: boom"],
            dryRun: false,
            planned: [],
          }),
          { status: 500 },
        ),
    ]);

    const result = await triggerAlertRun({ fetch, env: baseEnv() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("makes no request when DASHBOARD_INTERNAL_URL is missing", async () => {
    const { fetch, calls } = fetchSequence([]);

    const result = await triggerAlertRun({ fetch, env: { INTERNAL_SHARED_SECRET: SECRET } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("DASHBOARD_INTERNAL_URL");
    }
    expect(calls).toHaveLength(0);
  });

  it("makes no request when INTERNAL_SHARED_SECRET is missing", async () => {
    const { fetch, calls } = fetchSequence([]);

    const result = await triggerAlertRun({ fetch, env: { DASHBOARD_INTERNAL_URL: DASHBOARD_URL } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("INTERNAL_SHARED_SECRET");
    }
    expect(calls).toHaveLength(0);
  });

  it("never includes the token or the secret in an error message", async () => {
    const { fetch: metadataFailFetch } = fetchSequence([() => textResponse("nope", 500)]);
    const metadataFailure = await triggerAlertRun({ fetch: metadataFailFetch, env: baseEnv() });
    expect(metadataFailure.ok).toBe(false);
    if (!metadataFailure.ok) {
      expect(metadataFailure.error).not.toContain(SECRET);
      expect(metadataFailure.error).not.toContain(TOKEN);
    }

    const { fetch: dashboardFailFetch } = fetchSequence([
      () => textResponse(TOKEN),
      () => textResponse("server error", 500),
    ]);
    const dashboardFailure = await triggerAlertRun({ fetch: dashboardFailFetch, env: baseEnv() });
    expect(dashboardFailure.ok).toBe(false);
    if (!dashboardFailure.ok) {
      expect(dashboardFailure.error).not.toContain(SECRET);
      expect(dashboardFailure.error).not.toContain(TOKEN);
    }
  });

  it("times out the metadata call at 3s and does not call the dashboard", async () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      const fetchMock = (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      };

      const promise = triggerAlertRun({ fetch: fetchMock as typeof fetch, env: baseEnv() });
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain("timed out");
      }
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out the alert run call at 30s", async () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      const fetchMock = (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (calls.length === 1) {
          return Promise.resolve(textResponse(TOKEN));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      };

      const promise = triggerAlertRun({ fetch: fetchMock as typeof fetch, env: baseEnv() });
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain("timed out");
      }
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
