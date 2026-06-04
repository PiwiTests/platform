ALTER TABLE "test_runs" ADD COLUMN "instance_id" text;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "worker_index" integer;
