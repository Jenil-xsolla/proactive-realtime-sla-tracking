-- Custom SQL migration file, put your code below! --
-- Grants the two Cloud Run service database users the exact per-service
-- access from main spec §5.1 ("Ownership"). The roles (app_user,
-- ingestion_writer) are NOT created here: infra creates them before this
-- migration runs, and the deploy runbook (Task 23) documents that
-- prerequisite.
--
-- USAGE ON SCHEMA public is granted to both roles: PGlite does not require
-- it for a non-owner role to SELECT/INSERT/UPDATE/DELETE (grants alone were
-- enough in tests), but Cloud SQL on Postgres 15+ revokes the default
-- CREATE-and-USAGE-to-PUBLIC grant on the public schema, and a role needs
-- USAGE on the schema to reach the tables inside it there.
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ingestion_writer;
--> statement-breakpoint

-- ingestion_writer (sla-ingestion): SELECT/INSERT/UPDATE/DELETE on
-- sla_outages (DELETE because a correction can remove a partner);
-- SELECT/INSERT/UPDATE on sla_pir_reviews; SELECT/INSERT on
-- sla_outage_corrections.
GRANT SELECT, INSERT, UPDATE, DELETE ON sla_outages TO ingestion_writer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sla_pir_reviews TO ingestion_writer;
--> statement-breakpoint
GRANT SELECT, INSERT ON sla_outage_corrections TO ingestion_writer;
--> statement-breakpoint

-- ingestion_writer needs USAGE on the serial sequences behind the two
-- tables it inserts into with serial primary keys.
GRANT USAGE ON SEQUENCE sla_outages_id_seq TO ingestion_writer;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE sla_outage_corrections_id_seq TO ingestion_writer;
--> statement-breakpoint

-- app_user (sla-dashboard): SELECT on sla_outages, sla_pir_reviews,
-- sla_outage_corrections; SELECT/INSERT/UPDATE on sla_alert_state.
-- No sequence grant: sla_alert_state has no serial column.
GRANT SELECT ON sla_outages TO app_user;
--> statement-breakpoint
GRANT SELECT ON sla_pir_reviews TO app_user;
--> statement-breakpoint
GRANT SELECT ON sla_outage_corrections TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sla_alert_state TO app_user;
