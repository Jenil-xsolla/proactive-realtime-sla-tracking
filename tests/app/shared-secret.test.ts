import { describe, expect, it } from "vitest";
import { secretMatches } from "@/app/api/shared-secret";

describe("secretMatches", () => {
  it("matches when provided equals expected", () => {
    expect(secretMatches("shh", "shh")).toBe(true);
  });

  it("rejects a wrong value of the same length", () => {
    expect(secretMatches("shx", "shh")).toBe(false);
  });

  it("rejects a value of a different length before comparing bytes", () => {
    expect(secretMatches("longer-secret", "shh")).toBe(false);
    expect(secretMatches("s", "shh")).toBe(false);
  });

  it("rejects when expected is undefined", () => {
    expect(secretMatches("shh", undefined)).toBe(false);
  });

  it("rejects when expected is empty", () => {
    expect(secretMatches("shh", "")).toBe(false);
  });

  it("rejects when provided is null", () => {
    expect(secretMatches(null, "shh")).toBe(false);
  });

  it("rejects when both are empty", () => {
    expect(secretMatches("", "")).toBe(false);
  });
});
