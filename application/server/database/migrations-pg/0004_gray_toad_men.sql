ALTER TABLE "test_runs" ADD COLUMN "setup_steps" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "step_events" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "shard_total" integer;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "shards_finished" integer DEFAULT 0 NOT NULL;
