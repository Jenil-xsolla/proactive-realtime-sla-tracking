CREATE TABLE "sla_outage_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"pir_key" text NOT NULL,
	"corrected_by" text NOT NULL,
	"corrected_at" timestamp with time zone NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "sla_pir_reviews" (
	"pir_key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"unresolved_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"incident_started" timestamp with time zone,
	"outage_minutes" numeric,
	"affected_services" jsonb,
	"severity" text,
	"pir_url" text,
	"slack_channel" text,
	"slack_ts" text,
	"slack_error" text,
	"error" text,
	"received_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sla_pir_reviews_status_check" CHECK ("sla_pir_reviews"."status" in ('received','skipped','captured','failed'))
);
--> statement-breakpoint
ALTER TABLE "sla_outage_corrections" ADD CONSTRAINT "sla_outage_corrections_pir_key_sla_pir_reviews_pir_key_fk" FOREIGN KEY ("pir_key") REFERENCES "public"."sla_pir_reviews"("pir_key") ON DELETE no action ON UPDATE no action;