import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { schema } from "@/data/db";

const migrationsFolder = resolve(process.cwd(), "src/data/migrations");

/**
 * Runs the real Drizzle migrations from src/data/migrations against a live
 * Postgres database (docs/deploy.md "Database"). `drizzle-kit migrate` has
 * no `--url` flag and drizzle.config.ts has no `dbCredentials`, so this
 * script is the supported way to run migrations outside the PGlite test
 * suite (tests/support/database.ts runs them against an in-memory instance
 * the same way, via the pglite migrator instead of this one).
 *
 * Must be run with the connection string for the schema-owner role — never
 * `app_user` or `ingestion_writer`, which only receive grants in
 * 0004_service_grants.sql and don't own the schema — and only after infra
 * has created both of those roles, since that migration grants to them.
 */
export function getMigrationDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATION_DATABASE_URL is required");
  }
  return url;
}

async function main(): Promise<void> {
  const connectionString = getMigrationDatabaseUrl();
  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    process.stdout.write(`Migrations applied from ${migrationsFolder}\n`);
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
const invokedDirectly =
  entry !== undefined &&
  (basename(entry) === "migrate.ts" || import.meta.url === pathToFileURL(entry).href);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  });
}
