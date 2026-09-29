import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isPathAllowed, readServiceRole } from "@/service-role";
import { proxy } from "@/proxy";
import { register } from "@/instrumentation";

const originalRole = process.env.SERVICE_ROLE;

afterEach(() => {
  if (originalRole === undefined) {
    delete process.env.SERVICE_ROLE;
  } else {
    process.env.SERVICE_ROLE = originalRole;
  }
});

describe("readServiceRole", () => {
  it("accepts 'dashboard'", () => {
    expect(readServiceRole({ SERVICE_ROLE: "dashboard" })).toBe("dashboard");
  });

  it("accepts 'ingestion'", () => {
    expect(readServiceRole({ SERVICE_ROLE: "ingestion" })).toBe("ingestion");
  });

  it("throws when SERVICE_ROLE is undefined", () => {
    expect(() => readServiceRole({})).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got undefined",
    );
  });

  it("throws when SERVICE_ROLE is empty", () => {
    expect(() => readServiceRole({ SERVICE_ROLE: "" })).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got \"\"",
    );
  });

  it("throws on a case or whitespace variant, no trimming or case folding", () => {
    expect(() => readServiceRole({ SERVICE_ROLE: "Dashboard " })).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got \"Dashboard \"",
    );
  });

  it("throws on an unknown value", () => {
    expect(() => readServiceRole({ SERVICE_ROLE: "admin" })).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got \"admin\"",
    );
  });
});

describe("isPathAllowed", () => {
  describe("ingestion role", () => {
    it("allows /api/ingest/pir-approved", () => {
      expect(isPathAllowed("ingestion", "/api/ingest/pir-approved")).toBe(true);
    });

    it("allows /api/slack/interactions", () => {
      expect(isPathAllowed("ingestion", "/api/slack/interactions")).toBe(true);
    });

    it("tolerates an optional trailing slash on its paths", () => {
      expect(isPathAllowed("ingestion", "/api/ingest/pir-approved/")).toBe(true);
      expect(isPathAllowed("ingestion", "/api/slack/interactions/")).toBe(true);
    });

    it("404s /", () => {
      expect(isPathAllowed("ingestion", "/")).toBe(false);
    });

    it("404s /api/sla/feed", () => {
      expect(isPathAllowed("ingestion", "/api/sla/feed")).toBe(false);
    });

    it("404s /api/internal/alerts/run", () => {
      expect(isPathAllowed("ingestion", "/api/internal/alerts/run")).toBe(false);
    });

    it("404s /_next/static/x.js — not even Next's own assets", () => {
      expect(isPathAllowed("ingestion", "/_next/static/x.js")).toBe(false);
    });

    it("404s a sub-path below one of its own paths", () => {
      expect(isPathAllowed("ingestion", "/api/ingest/pir-approved/extra")).toBe(false);
    });
  });

  describe("dashboard role", () => {
    it("allows /", () => {
      expect(isPathAllowed("dashboard", "/")).toBe(true);
    });

    it("allows /api/sla/feed", () => {
      expect(isPathAllowed("dashboard", "/api/sla/feed")).toBe(true);
    });

    it("allows /api/internal/alerts/run", () => {
      expect(isPathAllowed("dashboard", "/api/internal/alerts/run")).toBe(true);
    });

    it("404s /api/ingest/pir-approved", () => {
      expect(isPathAllowed("dashboard", "/api/ingest/pir-approved")).toBe(false);
    });

    it("404s /api/slack/interactions", () => {
      expect(isPathAllowed("dashboard", "/api/slack/interactions")).toBe(false);
    });

    it("404s a sub-path below an ingestion-only path", () => {
      expect(isPathAllowed("dashboard", "/api/ingest/pir-approved/extra")).toBe(false);
    });
  });
});

describe("proxy", () => {
  afterEach(() => {
    if (originalRole === undefined) {
      delete process.env.SERVICE_ROLE;
    } else {
      process.env.SERVICE_ROLE = originalRole;
    }
  });

  it("returns 404 with no-store for a blocked path", async () => {
    process.env.SERVICE_ROLE = "ingestion";

    const response = await proxy(new NextRequest("http://localhost/api/sla/feed"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes an allowed path through", async () => {
    process.env.SERVICE_ROLE = "ingestion";

    const response = await proxy(
      new NextRequest("http://localhost/api/ingest/pir-approved"),
    );

    expect(response.status).toBe(200);
  });

  it("fails closed (404) when SERVICE_ROLE is missing", async () => {
    delete process.env.SERVICE_ROLE;

    const response = await proxy(new NextRequest("http://localhost/"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("register", () => {
  it("throws on a missing SERVICE_ROLE", () => {
    delete process.env.SERVICE_ROLE;

    expect(() => register()).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got undefined",
    );
  });

  it("passes on a valid SERVICE_ROLE", () => {
    process.env.SERVICE_ROLE = "dashboard";

    expect(() => register()).not.toThrow();
  });

  it("calls an injected exit(1) on a bad role, and still throws", () => {
    const exit = vi.fn();
    const log = vi.fn();

    expect(() => register({ env: {}, exit, log })).toThrow(
      "SERVICE_ROLE must be 'dashboard' or 'ingestion', got undefined",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      "[startup] SERVICE_ROLE must be 'dashboard' or 'ingestion', got undefined. Refusing to start.",
    );
  });

  it("calls process.exit(1) when NEXT_RUNTIME is nodejs and no exit override is given", () => {
    delete process.env.SERVICE_ROLE;
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      expect(() => register()).toThrow(
        "SERVICE_ROLE must be 'dashboard' or 'ingestion', got undefined",
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("never calls exit on a valid SERVICE_ROLE", () => {
    const exit = vi.fn();

    expect(() => register({ env: { SERVICE_ROLE: "ingestion" }, exit })).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });
});
