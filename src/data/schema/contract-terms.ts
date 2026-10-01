import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ContractFile } from "@/terms/types";

/**
 * One row per partner: the current contract terms. There is no history
 * table. An edit overwrites the previous figures and records who made the
 * last change and when.
 *
 * partner_slug is the registry slug, for example "second-dinner". It is not
 * sla_outages.partner_id, which is an external merchant id.
 *
 * version starts at 1 and increments on every save. A save whose expected
 * version does not match is refused.
 */
export const slaContractTerms = pgTable(
  "sla_contract_terms",
  {
    partnerSlug: text("partner_slug").primaryKey(),
    lifecycle: text("lifecycle").notNull(),
    /** Contract-file shape of spec §6.3. */
    terms: jsonb("terms").$type<ContractFile>().notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "sla_contract_terms_lifecycle_check",
      sql`${table.lifecycle} in ('terms_pending_review','contract_bound')`,
    ),
  ],
);
