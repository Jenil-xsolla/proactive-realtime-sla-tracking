import { sql } from "drizzle-orm";
import { check, numeric, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Owned by this repo (migrated from src/data/migrations, not the n8n
 * pipeline it replaces).
 *
 * outage_minutes is numeric and partner_id is text. node-postgres returns both
 * as strings. Leave them as strings here. partitionOutages parses each once.
 *
 * partner_id is an external merchant id, for example "506855". It is not a
 * foreign key. Do not join it to anything.
 */
export const slaOutages = pgTable(
  "sla_outages",
  {
    id: serial("id").primaryKey(),
    pirKey: text("pir_key").notNull(),
    partner: text("partner").notNull(),
    /** External merchant id stored as text. Not a foreign key. Do not join it. */
    partnerId: text("partner_id"),
    incidentStarted: timestamp("incident_started", { withTimezone: true }).notNull(),
    affectedService: text("affected_service").notNull(),
    outageMinutes: numeric("outage_minutes").notNull(),
    severity: text("severity"),
    /** 'pipeline' (written by ingestion) or 'backfill' (imported history). */
    source: text("source").notNull(),
    /** 'system_written' or 'human_corrected'. Null only for backfill rows. */
    decisionType: text("decision_type"),
    /** Slack username of the last corrector. Null unless decision_type is human_corrected. */
    reviewedBy: text("reviewed_by"),
    /** Reason given on the correction form. */
    reason: text("reason"),
    /** Time of the last correction. Null unless decision_type is human_corrected. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    pirUrl: text("pir_url"),
  },
  (table) => [
    unique("sla_outages_pir_key_partner_service_key").on(table.pirKey, table.partner, table.affectedService),
    check("sla_outages_source_check", sql`${table.source} in ('pipeline','backfill')`),
    check(
      "sla_outages_decision_type_check",
      sql`${table.decisionType} is null or ${table.decisionType} in ('system_written','human_corrected')`,
    ),
    check(
      "sla_outages_decision_type_source_check",
      sql`(${table.decisionType} is null) = (${table.source} = 'backfill')`,
    ),
    check(
      "sla_outages_reviewed_by_check",
      sql`coalesce(${table.decisionType} = 'human_corrected', false) = (${table.reviewedBy} is not null)`,
    ),
    check(
      "sla_outages_reviewed_at_check",
      sql`coalesce(${table.decisionType} = 'human_corrected', false) = (${table.reviewedAt} is not null)`,
    ),
    check("sla_outages_outage_minutes_check", sql`${table.outageMinutes} > 0`),
  ],
);
