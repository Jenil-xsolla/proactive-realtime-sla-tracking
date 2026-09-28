import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { slaAlertState } from "./schema/alert-state";
import { slaOutages } from "./schema/outages";

export const schema = { slaOutages, slaAlertState };

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

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
