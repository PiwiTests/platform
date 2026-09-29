ALTER TABLE "projects" ADD COLUMN "openapi_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "server_probes" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD COLUMN "snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD COLUMN "snoozed_at_run_id" integer;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD COLUMN "accepted_at" timestamp;