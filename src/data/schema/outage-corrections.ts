import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { slaPirReviews } from "./pir-reviews";

/**
 * One row per human correction, keyed to the PIR it corrects. before/after
 * hold the row set as JSON; a later task defines their exact shape, so
 * `.$type<unknown>()` is acceptable for now.
 */
export const slaOutageCorrections = pgTable("sla_outage_corrections", {
  id: serial("id").primaryKey(),
  pirKey: text("pir_key")
    .notNull()
    .references(() => slaPirReviews.pirKey),
  correctedBy: text("corrected_by").notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull(),
  before: jsonb("before").$type<unknown>().notNull(),
  after: jsonb("after").$type<unknown>().notNull(),
  reason: text("reason"),
});
