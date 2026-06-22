ALTER TABLE "test_runs" ADD COLUMN "is_full_run" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "filter_details" jsonb;