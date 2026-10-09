import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VIEW_COOKIE, resolveViewer } from "@/feed/viewer";

const original = process.env.VIEWER_ROLE;

beforeEach(() => {
  process.env.VIEWER_ROLE = "technical";
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.VIEWER_ROLE;
  } else {
    process.env.VIEWER_ROLE = original;
  }
});

describe("resolveViewer", () => {
  it("names the cookie sla_view", () => {
    expect(VIEW_COOKIE).toBe("sla_view");
  });

  it("lets a business cookie win over the env role", () => {
    expect(resolveViewer("business")).toEqual({ role: "business" });
  });

  it("lets a technical cookie win over a business env role", () => {
    process.env.VIEWER_ROLE = "business";
    expect(resolveViewer("technical")).toEqual({ role: "technical" });
  });

  it("ignores a system cookie and an absent cookie, and falls back to the env role", () => {
    process.env.VIEWER_ROLE = "business";
    expect(resolveViewer("system")).toEqual({ role: "business" });
    expect(resolveViewer(undefined)).toEqual({ role: "business" });
    expect(resolveViewer("admin")).toEqual({ role: "business" });
    expect(resolveViewer("")).toEqual({ role: "business" });
  });

  it("throws when there is no usable cookie and the env role is invalid", () => {
    process.env.VIEWER_ROLE = "nonsense";
    expect(() => resolveViewer(undefined)).toThrow("VIEWER_ROLE");
    expect(() => resolveViewer("system")).toThrow("VIEWER_ROLE");
  });

  it("does not need a valid env role when the cookie is a dashboard role", () => {
    delete process.env.VIEWER_ROLE;
    expect(resolveViewer("business")).toEqual({ role: "business" });
  });
});
