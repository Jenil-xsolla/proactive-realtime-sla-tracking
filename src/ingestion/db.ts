import { createDatabase, type Database } from "@/data";

/**
 * Mirrors src/data/db.ts's getDatabase(), but reads INGESTION_DATABASE_URL
 * and caches independently: the dashboard and ingestion apps connect to
 * different roles (sla_tracking_app_user vs sla_tracking_ingestion_writer, see the grants migration)
 * and must never share a cached pool.
 */
let database: Database | undefined;

export function getIngestionDatabase(): Database {
  if (database) {
    return database;
  }
  const connectionString = process.env.INGESTION_DATABASE_URL;
  if (!connectionString) {
    throw new Error("INGESTION_DATABASE_URL is required");
  }
  database = createDatabase(connectionString);
  return database;
}
