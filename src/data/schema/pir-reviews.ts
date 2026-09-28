import { sql } from "drizzle-orm";
import { check, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * An unresolved value found while extracting a PIR (D6): a merchant or
 * service ARI that could not be matched in the registry. It does not
 * fail the PIR; it is recorded here so a person can decide.
 */
export type UnresolvedValue = { kind: "merchant" | "service_ari"; raw: string };

/**
 * Ingestion log, one row per PIR (`pir_key`). Makes a half-processed PIR
 * visible instead of lost. The extracted values below are nullable
 * because they are unknown until the fetch runs (D4), so the correction
 * modal can still prefill even when the PIR has zero sla_outages rows.
 *
 * outage_minutes is numeric, like sla_outages.outage_minutes: node-postgres
 * returns it as a string.
 *
 * version starts at 0 and is incremented on every correction; "already
 * corrected" is decided per PIR from version > 0, not per row (D5).
 */
export const slaPirReviews = pgTable(
  "sla_pir_reviews",
  {
    pirKey: text("pir_key").primaryKey(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(0),
    unresolvedValues: jsonb("unresolved_values")
      .$type<UnresolvedValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    incidentStarted: timestamp("incident_started", { withTimezone: true }),
    /** numeric; node-postgres returns it as a string, like sla_outages.outage_minutes. */
    outageMinutes: numeric("outage_minutes"),
    /** Display names, not ARIs. */
    affectedServices: jsonb("affected_services").$type<string[]>(),
    severity: text("severity"),
    pirUrl: text("pir_url"),
    slackChannel: text("slack_channel"),
    slackTs: text("slack_ts"),
    slackError: text("slack_error"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("sla_pir_reviews_status_check", sql`${table.status} in ('received','skipped','captured','failed')`),
  ],
);
