-- Custom SQL migration file, put your code below! --
-- app_user (sla-dashboard) reads and writes contract terms. Spec §5.1.
-- ingestion_writer receives nothing: this table is not an ingestion table.
-- No sequence grant: sla_contract_terms has no serial column.
GRANT SELECT, INSERT, UPDATE ON sla_contract_terms TO app_user;
