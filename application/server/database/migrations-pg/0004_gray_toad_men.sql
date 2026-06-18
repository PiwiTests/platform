ALTER TABLE "test_runs" ADD COLUMN "setup_steps" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "step_events" jsonb;