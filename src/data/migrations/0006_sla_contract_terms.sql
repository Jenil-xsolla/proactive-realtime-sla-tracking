CREATE TABLE "sla_contract_terms" (
	"partner_slug" text PRIMARY KEY NOT NULL,
	"lifecycle" text NOT NULL,
	"terms" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sla_contract_terms_lifecycle_check" CHECK ("sla_contract_terms"."lifecycle" in ('terms_pending_review','contract_bound'))
);
