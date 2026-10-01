import { describe, expect, it } from "vitest";
import { fetchIssue, INCIDENT_FIELDS, PIR_FIELDS } from "@/ingestion/jira/client";

const TOKEN = "jira-test-token";
const EMAIL = "bot@xsolla.com";

const env = {
  JIRA_BASE_URL: "https://xsolla.atlassian.net",
  JIRA_EMAIL: EMAIL,
  JIRA_API_TOKEN: TOKEN,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchIssue", () => {
  it("builds the URL, auth header and Accept header from env", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary", "status"],
      env,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({ key: "GTO-543" });
      },
    });

    expect(result).toEqual({ ok: true, json: { key: "GTO-543" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://xsolla.atlassian.net/rest/api/3/issue/GTO-543?fields=summary%2Cstatus",
    );
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`);
    expect(headers.get("accept")).toBe("application/json");
    expect(calls[0]?.init.cache).toBe("no-store");
  });

  it("trims a trailing slash from JIRA_BASE_URL", async () => {
    const calls: string[] = [];
    await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env: { ...env, JIRA_BASE_URL: "https://xsolla.atlassian.net/" },
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({});
      },
    });

    expect(calls[0]).toBe("https://xsolla.atlassian.net/rest/api/3/issue/GTO-543?fields=summary");
  });

  it("reads env per call rather than at module load", async () => {
    const first = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env: { JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN },
      fetch: async () => jsonResponse({}),
    });
    expect(first).toEqual({ ok: false, error: expect.stringContaining("JIRA_BASE_URL") });

    const second = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env,
      fetch: async () => jsonResponse({}),
    });
    expect(second.ok).toBe(true);
  });

  it("returns ok: false naming the variable when JIRA_BASE_URL is missing, with no request made", async () => {
    let calls = 0;
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env: { JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN },
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("JIRA_BASE_URL") });
  });

  it("returns ok: false naming the variable when JIRA_EMAIL is missing, with no request made", async () => {
    let calls = 0;
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env: { JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_API_TOKEN: TOKEN },
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("JIRA_EMAIL") });
  });

  it("returns ok: false naming the variable when JIRA_API_TOKEN is missing, with no request made", async () => {
    let calls = 0;
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env: { JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_EMAIL: EMAIL },
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("JIRA_API_TOKEN") });
  });

  it("rejects a malformed key before any request", async () => {
    let calls = 0;
    const result = await fetchIssue({
      key: "not-a-key",
      fields: ["summary"],
      env,
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("turns a non-2xx response into ok: false with the status and key", async () => {
    const result = await fetchIssue({
      key: "GTO-1",
      fields: ["summary"],
      env,
      fetch: async () => new Response("not found", { status: 404 }),
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Jira returned HTTP 404 for GTO-1"),
    });
  });

  it("turns a timeout into ok: false", async () => {
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env,
      fetch: async () => {
        const error = new Error("The operation was aborted");
        error.name = "TimeoutError";
        throw error;
      },
    });

    expect(result).toEqual({ ok: false, error: "Jira request timed out" });
  });

  it("turns a non-JSON body into ok: false", async () => {
    const result = await fetchIssue({
      key: "GTO-543",
      fields: ["summary"],
      env,
      fetch: async () => new Response("<html>not json</html>", { status: 200 }),
    });

    expect(result.ok).toBe(false);
  });

  it("does not retry on failure", async () => {
    let calls = 0;
    await fetchIssue({
      key: "GTO-1",
      fields: ["summary"],
      env,
      fetch: async () => {
        calls += 1;
        return new Response("nope", { status: 500 });
      },
    });

    expect(calls).toBe(1);
  });

  it("never leaks the token, email or Authorization header in any error text", async () => {
    const scenarios: Promise<{ ok: true; json: unknown } | { ok: false; error: string }>[] = [
      fetchIssue({ key: "GTO-1", fields: ["summary"], env, fetch: async () => new Response("x", { status: 404 }) }),
      fetchIssue({
        key: "GTO-1",
        fields: ["summary"],
        env,
        fetch: async () => {
          const error = new Error("aborted");
          error.name = "TimeoutError";
          throw error;
        },
      }),
      fetchIssue({
        key: "GTO-1",
        fields: ["summary"],
        env,
        fetch: async () => new Response("not json", { status: 200 }),
      }),
      fetchIssue({ key: "not-a-key", fields: ["summary"], env, fetch: async () => jsonResponse({}) }),
      fetchIssue({
        key: "GTO-1",
        fields: ["summary"],
        env: { JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_EMAIL: EMAIL },
        fetch: async () => jsonResponse({}),
      }),
    ];

    const results = await Promise.all(scenarios);
    const auth = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).not.toContain(TOKEN);
      expect(result.error).not.toContain(EMAIL);
      expect(result.error).not.toContain(auth);
      expect(result.error.toLowerCase()).not.toContain("authorization");
    }
  });

  it("exports the PIR and incident field lists for the orchestration task to reuse", () => {
    expect(PIR_FIELDS).toEqual([
      "summary",
      "status",
      "created",
      "customfield_11646",
      "customfield_31331",
      "customfield_10399",
      "customfield_13920",
      "customfield_10250",
      "issuelinks",
    ]);
    expect(INCIDENT_FIELDS).toEqual(["customfield_10068", "created"]);
  });
});
