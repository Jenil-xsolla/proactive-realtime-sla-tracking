import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema } from "@/data/db";

const migrationsFolder = path.resolve(process.cwd(), "src/data/migrations");

export interface TestDatabase {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
}

/**
 * Opens a fresh in-memory Postgres (PGlite) instance, creates the two
 * application roles the grants migration targets, and runs the real
 * Drizzle migrations from src/data/migrations against it. Every call
 * returns an independent instance.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();

  await client.exec("CREATE ROLE app_user NOLOGIN;");
  await client.exec("CREATE ROLE ingestion_writer NOLOGIN;");

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });

  return {
    db,
    client,
    close: () => client.close(),
  };
}
