import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readContractTerms } from "@/data";
import {
  CONTRACT_TERMS_FILE,
  getSeedDatabaseUrl,
  parseSeedArgs,
  seedContractTermsFile,
} from "../../scripts/seed-contract-terms";
import { createTestDatabase, type TestDatabase } from "../support/database";

/**
 * Illustrative figures only. Not a contract, and not the local seed file.
 * target 91 and credit 3 are chosen so a log line that leaked the file would fail this test.
 */
const ILLUSTRATIVE = [
  {
    partner: "roblox",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [
      {
        kind: "service",
        scopeId: "illustrative-payments",
        services: ["payments"],
        target: 91,
        penalty: {
          kind: "tiers",
          perScopeCap: null,
          tiers: [
            { atOrAbove: 91, credit: 0 },
            { atOrAbove: 0, credit: 3 },
          ],
        },
        sourceClause: "ILLUSTRATIVE — not a contract clause",
      },
    ],
  },
];

function writeIllustrative(entries: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sla-seed-"));
  const file = path.join(dir, "terms.json");
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

describe("seed contract terms", () => {
  let testDb: TestDatabase | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it("reads DATABASE_URL and treats --force as the only flag", () => {
    expect(CONTRACT_TERMS_FILE).toBe(".local/contract-terms.json");
    expect(() => getSeedDatabaseUrl({})).toThrow(/DATABASE_URL is required/);
    expect(getSeedDatabaseUrl({ DATABASE_URL: "postgres://app_user@host/db" })).toBe(
      "postgres://app_user@host/db",
    );
    expect(parseSeedArgs([])).toEqual({ force: false });
    expect(parseSeedArgs(["--force"])).toEqual({ force: true });
    expect(() => parseSeedArgs(["--partner"])).toThrow(/--partner/);
  });

  it("saves each entry as contract_bound with updatedBy seed", async () => {
    testDb = await createTestDatabase();
    const lines: string[] = [];
    const file = writeIllustrative(ILLUSTRATIVE);

    const results = await seedContractTermsFile(testDb.db, file, {
      force: false,
      write: (line) => lines.push(line),
    });

    expect(results).toEqual([{ partner: "roblox", action: "saved", version: 1 }]);
    const rows = await readContractTerms(testDb.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partnerSlug: "roblox",
      lifecycle: "contract_bound",
      version: 1,
      updatedBy: "seed",
    });
    expect(lines.join("\n")).not.toMatch(/91|credit/);
  });

  it("prints loader warnings and still saves", async () => {
    testDb = await createTestDatabase();
    const lines: string[] = [];
    const file = writeIllustrative([
      {
        ...ILLUSTRATIVE[0],
        scopes: [{ ...ILLUSTRATIVE[0].scopes[0], sourceClause: undefined }],
      },
    ]);

    await seedContractTermsFile(testDb.db, file, {
      force: false,
      write: (line) => lines.push(line),
    });

    expect(lines.some((line) => /sourceClause/.test(line))).toBe(true);
    expect((await readContractTerms(testDb.db))[0]?.lifecycle).toBe("contract_bound");
    expect(lines.join("\n")).not.toMatch(/\b91\b|\b3\b/);
  });

  it("skips a partner who already has a row, and says so", async () => {
    testDb = await createTestDatabase();
    const file = writeIllustrative(ILLUSTRATIVE);
    await seedContractTermsFile(testDb.db, file, { force: false, write: () => undefined });
    const lines: string[] = [];

    const results = await seedContractTermsFile(testDb.db, file, {
      force: false,
      write: (line) => lines.push(line),
    });

    expect(results).toEqual([{ partner: "roblox", action: "skipped", version: 1 }]);
    expect(lines.join("\n").toLowerCase()).toMatch(/skip/);
    expect((await readContractTerms(testDb.db))[0]?.version).toBe(1);
  });

  it("replaces an existing row when run with --force", async () => {
    testDb = await createTestDatabase();
    const first = writeIllustrative(ILLUSTRATIVE);
    await seedContractTermsFile(testDb.db, first, { force: false, write: () => undefined });
    const replacement = writeIllustrative([
      { ...ILLUSTRATIVE[0], effectiveFrom: "2026-06-01" },
    ]);

    const results = await seedContractTermsFile(testDb.db, replacement, {
      force: true,
      write: () => undefined,
    });

    expect(results).toEqual([{ partner: "roblox", action: "saved", version: 2 }]);
    expect((await readContractTerms(testDb.db))[0]?.terms.effectiveFrom).toBe("2026-06-01");
  });

  it("refuses an unknown partner and saves nothing", async () => {
    testDb = await createTestDatabase();
    const file = writeIllustrative([{ ...ILLUSTRATIVE[0], partner: "not-a-partner" }]);

    await expect(
      seedContractTermsFile(testDb.db, file, { force: false, write: () => undefined }),
    ).rejects.toThrow(/Unknown partner/);
    expect(await readContractTerms(testDb.db)).toEqual([]);
  });

  it("saves nothing when any entry fails validation", async () => {
    testDb = await createTestDatabase();
    const file = writeIllustrative([
      ILLUSTRATIVE[0],
      {
        ...ILLUSTRATIVE[0],
        partner: "twitch",
        scopes: [{ ...ILLUSTRATIVE[0].scopes[0], scopeId: "bad", target: 200 }],
      },
    ]);

    await expect(
      seedContractTermsFile(testDb.db, file, { force: false, write: () => undefined }),
    ).rejects.toThrow(/0 to 100/);
    expect(await readContractTerms(testDb.db)).toEqual([]);
  });
});
