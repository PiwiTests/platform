ALTER TABLE "test_runs" ADD COLUMN "resource_report" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "resources" jsonb;