-- Custom SQL migration file, put your code below! --
-- sla_tracking_app_user (sla-dashboard) reads and writes contract terms. Spec §5.1.
-- sla_tracking_ingestion_writer receives nothing: this table is not an ingestion table.
-- No sequence grant: sla_contract_terms has no serial column.
GRANT SELECT, INSERT, UPDATE ON sla_contract_terms TO sla_tracking_app_user;
