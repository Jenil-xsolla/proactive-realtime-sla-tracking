import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { slaAlertState } from "./schema/alert-state";
import { slaContractTerms } from "./schema/contract-terms";
import { slaOutageCorrections } from "./schema/outage-corrections";
import { slaOutages } from "./schema/outages";
import { slaPirReviews } from "./schema/pir-reviews";

export const schema = {
  slaOutages,
  slaAlertState,
  slaPirReviews,
  slaOutageCorrections,
  slaContractTerms,
};

/**
 * pg's default idle timeout is 10s, which closes every connection between
 * page loads and makes each one pay connection setup again. Holding them
 * longer needs keepAlive and an error listener: an idle client the server
 * drops emits "error" on the pool, and with no listener that ends the process.
 */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 900_000, keepAlive: true });
  pool.on("error", (error) => {
    console.error("[db] idle client", error);
  });
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
