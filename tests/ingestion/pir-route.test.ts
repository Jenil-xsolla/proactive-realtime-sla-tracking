import { afterEach, describe, expect, it, vi } from "vitest";

const runPirApproved = vi.fn();

vi.mock("@/ingestion", () => ({
  runPirApproved: (...args: unknown[]) => runPirApproved(...args),
}));

import * as route from "@/app/api/ingest/pir-approved/route";

const originalSecret = process.env.JIRA_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.JIRA_WEBHOOK_SECRET;
  } else {
    process.env.JIRA_WEBHOOK_SECRET = originalSecret;
  }
  vi.clearAllMocks();
});

function post(options: { headerName?: string; secret?: string; body?: string } = {}): Promise<Response> {
  const headers = new Headers();
  if (options.secret !== undefined) {
    headers.set(options.headerName ?? "jira-webhook-token", options.secret);
  }
  return route.POST(
    new Request("http://localhost/api/ingest/pir-approved", {
      method: "POST",
      headers,
      body: options.body,
    }),
  );
}

describe("POST /api/ingest/pir-approved module shape", () => {
  it("exports exactly POST, dynamic and fetchCache", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic", "fetchCache"]);
  });
});

describe("POST /api/ingest/pir-approved", () => {
  it("rejects a request with no secret header", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ secret: "wrong", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(401);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("rejects every request when JIRA_WEBHOOK_SECRET is unset, even with a header present", async () => {
    delete process.env.JIRA_WEBHOOK_SECRET;

    const response = await post({ secret: "anything", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(401);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("accepts the header regardless of its case", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockResolvedValue({ kind: "captured", rowCount: 1, messagePosted: true });

    const response = await post({
      headerName: "Jira-Webhook-Token",
      secret: "shh",
      body: JSON.stringify({ issueKey: "GTO-1" }),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a non-JSON body", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ secret: "shh", body: "{" });

    expect(response.status).toBe(400);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("rejects an array body", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ secret: "shh", body: JSON.stringify(["GTO-1"]) });

    expect(response.status).toBe(400);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("rejects a body with a missing issueKey", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ secret: "shh", body: JSON.stringify({}) });

    expect(response.status).toBe(400);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("rejects a body with a blank issueKey", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";

    const response = await post({ secret: "shh", body: JSON.stringify({ issueKey: "   " }) });

    expect(response.status).toBe(400);
    expect(runPirApproved).not.toHaveBeenCalled();
  });

  it("returns 500 when runPirApproved throws (ingestion misconfigured), without leaking the message", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockRejectedValue(new Error("JIRA_BASE_URL is required"));

    const response = await post({ secret: "shh", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "ingestion is not configured" });
  });

  it("returns 200 with the outcome for a captured PIR, calling runPirApproved with the trimmed key", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockResolvedValue({ kind: "captured", rowCount: 2, messagePosted: true });

    const response = await post({ secret: "shh", body: JSON.stringify({ issueKey: "  GTO-1  " }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ issueKey: "GTO-1", outcome: "captured" });
    expect(runPirApproved).toHaveBeenCalledWith("GTO-1");
  });

  it("returns 200 with the outcome for a failed PIR, per spec (Jira Automation does not retry)", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockResolvedValue({ kind: "failed", error: "boom" });

    const response = await post({ secret: "shh", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ issueKey: "GTO-1", outcome: "failed" });
  });

  it("returns 200 with the outcome for a receipt_failed PIR", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockResolvedValue({ kind: "receipt_failed", error: "db down" });

    const response = await post({ secret: "shh", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ issueKey: "GTO-1", outcome: "receipt_failed" });
  });

  it("carries Cache-Control: no-store on every response", async () => {
    process.env.JIRA_WEBHOOK_SECRET = "shh";
    runPirApproved.mockResolvedValue({ kind: "captured", rowCount: 1, messagePosted: true });

    const unauthorized = await post({ body: JSON.stringify({ issueKey: "GTO-1" }) });
    const badBody = await post({ secret: "shh", body: "{" });
    const ok = await post({ secret: "shh", body: JSON.stringify({ issueKey: "GTO-1" }) });

    expect(unauthorized.headers.get("cache-control")).toBe("no-store");
    expect(badBody.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});
