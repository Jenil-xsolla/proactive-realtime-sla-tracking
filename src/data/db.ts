import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { slaAlertState } from "./schema/alert-state";
import { slaOutageCorrections } from "./schema/outage-corrections";
import { slaOutages } from "./schema/outages";
import { slaPirReviews } from "./schema/pir-reviews";

export const schema = { slaOutages, slaAlertState, slaPirReviews, slaOutageCorrections };

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

/**
 * Driver-neutral so a PGlite-backed database (tests/support/database.ts)
 * type-checks against the same signature as the node-postgres database
 * this app runs in production. Writer/loader functions take `Database`,
 * never a driver-specific type, so either driver can be passed in.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let database: Database | undefined;

export function getDatabase(): Database {
  if (database) {
    return database;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  database = createDatabase(connectionString);
  return database;
}
