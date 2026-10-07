import { describe, expect, it } from "vitest";
import { GET } from "@/app/view/[role]/route";

function call(role: string, referer?: string, url = "http://localhost:3000/view/") {
  const headers: Record<string, string> = referer === undefined ? {} : { referer };
  return GET(new Request(`${url}${role}`, { headers }), { params: Promise.resolve({ role }) });
}

describe("GET /view/[role]", () => {
  it("sets the cookie and returns to the referring page with its window", async () => {
    const response = await call("business", "http://localhost:3000/partners/scopely?window=2026-08");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/partners/scopely?window=2026-08");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sla_view=business");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sets Secure on https", async () => {
    const response = await call("technical", "https://sla.example.com/", "https://sla.example.com/view/");
    expect(response.headers.get("set-cookie")).toContain("sla_view=technical");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    ["alerts", "http://localhost:3000/alerts?window=2026-08", "/?window=2026-08"],
    ["health", "http://localhost:3000/health", "/"],
    ["terms", "http://localhost:3000/partners/scopely/terms?window=2026-08", "/?window=2026-08"],
  ])("sends business off the engineer-only %s page to the overview", async (_name, referer, expected) => {
    const response = await call("business", referer);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(expected);
    expect(response.headers.get("set-cookie")).toContain("sla_view=business");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps engineer-only pages as the target when switching to technical", async () => {
    const response = await call("technical", "http://localhost:3000/alerts?window=2026-08");
    expect(response.headers.get("location")).toBe("/alerts?window=2026-08");
  });

  it("does not mistake a partner page for a terms page", async () => {
    const response = await call("business", "http://localhost:3000/partners/scopely?window=2026-08");
    expect(response.headers.get("location")).toBe("/partners/scopely?window=2026-08");
  });

  it("redirects to / for a foreign-origin referer", async () => {
    const response = await call("business", "https://evil.example.com/partners/scopely?window=2026-08");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([[undefined], ["not a url"]])("redirects to / for a missing or malformed referer (%s)", async (referer) => {
    const response = await call("technical", referer);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });

  it("returns 404 and no cookie for an unknown role", async () => {
    for (const role of ["admin", "system"]) {
      const response = await call(role, "http://localhost:3000/");
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it.each([
    ["a protocol-relative path", "http://localhost:3000//evil.com/x?window=2026-08"],
    ["a backslash path", "http://localhost:3000/\\evil.com"],
  ])("never redirects to %s", async (_name, referer) => {
    for (const role of ["business", "technical"]) {
      const response = await call(role, referer);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
    }
  });

  it("does not treat /alertsfoo as the engineer-only alerts page", async () => {
    const response = await call("business", "http://localhost:3000/alertsfoo?window=2026-08");
    expect(response.headers.get("location")).toBe("/alertsfoo?window=2026-08");
  });

  it("trusts the forwarded proto and host behind a proxy, for both Secure and the same-origin check", async () => {
    const response = await GET(
      new Request("http://internal:8080/view/business", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "sla.example.com",
          referer: "https://sla.example.com/partners/scopely?window=2026-08",
        },
      }),
      { params: Promise.resolve({ role: "business" }) },
    );
    expect(response.headers.get("location")).toBe("/partners/scopely?window=2026-08");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("falls back to the host header when only the forwarded proto is set", async () => {
    const response = await GET(
      new Request("http://internal:8080/view/technical", {
        headers: { "x-forwarded-proto": "https", host: "sla.example.com", referer: "https://sla.example.com/alerts" },
      }),
      { params: Promise.resolve({ role: "technical" }) },
    );
    expect(response.headers.get("location")).toBe("/alerts");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("redirects to / when the referer host differs and there are no forwarded headers", async () => {
    const response = await GET(
      new Request("http://internal:8080/view/business", { headers: { referer: "https://sla.example.com/partners/scopely?window=2026-08" } }),
      { params: Promise.resolve({ role: "business" }) },
    );
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });
});
