import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readContractTerms, saveContractTerms, schema, type ContractTermsBody } from "@/data";
import type { ContractScope } from "@/terms";
import { createTestDatabase, type TestDatabase } from "../support/database";

const PUBLIC_TABLES = [
  "sla_alert_state",
  "sla_contract_terms",
  "sla_outage_corrections",
  "sla_outages",
  "sla_pir_reviews",
];

const MIGRATIONS_FOLDER = path.resolve("src/data/migrations");

const APPLIED_BEFORE_CONTRACT_TERMS = [
  "0000_sla_alert_state",
  "0001_sla_alert_state_partner_slug",
  "0002_sla_outages",
  "0003_pir_reviews_and_corrections",
  "0004_service_grants",
  "0005_corrections_pir_key_index",
];

function scope(overrides: Partial<ContractScope> = {}): ContractScope {
  return {
    kind: "service",
    scopeId: "payments",
    services: ["payments"],
    target: 99.95,
    penalty: { kind: "none" },
    sourceClause: "FIXTURE — not a contract clause",
    ...overrides,
  };
}

function body(overrides: Partial<ContractTermsBody> = {}): ContractTermsBody {
  return {
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [scope()],
    ...overrides,
  };
}

async function publicTables(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return result.rows.map((row) => row.table_name).sort();
}

describe("sla_contract_terms migrations", () => {
  let testDb: TestDatabase | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it("creates all five tables on a fresh database", async () => {
    testDb = await createTestDatabase();

    expect(await publicTables(testDb.client)).toEqual([...PUBLIC_TABLES].sort());
  });

  it("creates sla_contract_terms on a database that already has the first four tables", async () => {
    const client = new PGlite();
    try {
      await client.exec("CREATE ROLE sla_tracking_app_user NOLOGIN;");
      await client.exec("CREATE ROLE sla_tracking_ingestion_writer NOLOGIN;");
      for (const tag of APPLIED_BEFORE_CONTRACT_TERMS) {
        const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) {
          const trimmed = statement.trim();
          if (trimmed !== "") {
            await client.exec(trimmed);
          }
        }
      }

      const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
        entries: { tag: string; when: number }[];
      };
      const prior = journal.entries.find((entry) => entry.tag === "0005_corrections_pir_key_index");
      expect(prior).toBeDefined();

      await client.exec("CREATE SCHEMA IF NOT EXISTS drizzle");
      await client.exec(
        `CREATE TABLE drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );
      await client.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [
        "applied-through-0005",
        prior?.when,
      ]);

      const db = drizzle(client, { schema });
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      expect(await publicTables(client)).toEqual([...PUBLIC_TABLES].sort());
    } finally {
      await client.close();
    }
  });

  it("stores the spec columns, defaults version to 1, and rejects any other lifecycle", async () => {
    testDb = await createTestDatabase();

    const columns = await testDb.client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'sla_contract_terms'`,
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row]));

    expect([...byName.keys()].sort()).toEqual([
      "created_at",
      "lifecycle",
      "partner_slug",
      "terms",
      "updated_at",
      "updated_by",
      "version",
    ]);
    for (const name of ["partner_slug", "lifecycle", "terms", "version", "updated_by", "updated_at", "created_at"]) {
      expect(byName.get(name)?.is_nullable).toBe("NO");
    }
    expect(byName.get("partner_slug")?.data_type).toBe("text");
    expect(byName.get("lifecycle")?.data_type).toBe("text");
    expect(byName.get("terms")?.data_type).toBe("jsonb");
    expect(byName.get("version")?.data_type).toBe("integer");
    expect(byName.get("updated_by")?.data_type).toBe("text");
    expect(byName.get("updated_at")?.data_type).toBe("timestamp with time zone");
    expect(byName.get("created_at")?.data_type).toBe("timestamp with time zone");

    const inserted = await testDb.client.query<{ version: number }>(
      `insert into sla_contract_terms (partner_slug, lifecycle, terms, updated_by, updated_at, created_at)
       values ('scopely', 'terms_pending_review', '{}', 'ada', now(), now())
       returning version`,
    );
    expect(inserted.rows[0]?.version).toBe(1);

    await expect(
      testDb.client.query(
        `insert into sla_contract_terms (partner_slug, lifecycle, terms, updated_by, updated_at, created_at)
         values ('niantic', 'tracking_only', '{}', 'ada', now(), now())`,
      ),
    ).rejects.toThrow();
  });
});

describe("saveContractTerms", () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    await testDb?.close();
  });

  it("inserts a row at version 1, then updates it and increments the version", async () => {
    testDb = await createTestDatabase();

    const inserted = await saveContractTerms(
      testDb.db,
      "roblox",
      body(),
      "contract_bound",
      "ada",
      null,
    );
    expect(inserted).toEqual({ kind: "saved", version: 1 });

    const created = await readContractTerms(testDb.db);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      partnerSlug: "roblox",
      lifecycle: "contract_bound",
      version: 1,
      updatedBy: "ada",
      terms: {
        partner: "roblox",
        lifecycle: "contract_bound",
        effectiveFrom: "2026-01-01",
      },
    });

    const updated = await saveContractTerms(
      testDb.db,
      "roblox",
      body({ effectiveFrom: "2026-02-01" }),
      "terms_pending_review",
      "grace",
      1,
    );
    expect(updated).toEqual({ kind: "saved", version: 2 });

    const rows = await readContractTerms(testDb.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.lifecycle).toBe("terms_pending_review");
    expect(rows[0]?.updatedBy).toBe("grace");
    expect(rows[0]?.terms.effectiveFrom).toBe("2026-02-01");
    expect(rows[0]?.createdAt).toEqual(created[0]?.createdAt);
  });

  it("refuses a stale version and leaves the row unchanged", async () => {
    testDb = await createTestDatabase();
    await saveContractTerms(testDb.db, "roblox", body(), "contract_bound", "ada", null);
    await saveContractTerms(
      testDb.db,
      "roblox",
      body({ effectiveFrom: "2026-02-01" }),
      "terms_pending_review",
      "grace",
      1,
    );
    const before = await readContractTerms(testDb.db);

    const stale = await saveContractTerms(
      testDb.db,
      "roblox",
      body({ effectiveFrom: "2026-03-01" }),
      "contract_bound",
      "ada",
      1,
    );

    expect(stale).toEqual({ kind: "conflict" });
    expect(await readContractTerms(testDb.db)).toEqual(before);
  });

  it("refuses a file the loader rejects and writes nothing", async () => {
    testDb = await createTestDatabase();

    await expect(
      saveContractTerms(
        testDb.db,
        "twitch",
        body({ scopes: [scope({ target: 200 })] }),
        "contract_bound",
        "ada",
        null,
      ),
    ).rejects.toThrow(/0 to 100/);

    expect(await readContractTerms(testDb.db)).toEqual([]);
  });
});
