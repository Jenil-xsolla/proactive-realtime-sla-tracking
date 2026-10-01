import { describe, expect, it } from "vitest";
import { getMigrationDatabaseUrl } from "../../scripts/migrate";

describe("getMigrationDatabaseUrl", () => {
  it("throws a clear error when MIGRATION_DATABASE_URL is unset", () => {
    expect(() => getMigrationDatabaseUrl({})).toThrow(/MIGRATION_DATABASE_URL is required/);
  });

  it("throws when MIGRATION_DATABASE_URL is an empty string", () => {
    expect(() => getMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: "" })).toThrow(
      /MIGRATION_DATABASE_URL is required/,
    );
  });

  it("returns the value when set", () => {
    expect(
      getMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: "postgres://owner@host/db" }),
    ).toBe("postgres://owner@host/db");
  });
});
