ALTER TABLE "projects" ADD COLUMN "default_branch" text;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "branch" text;--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_branch_start" ON "test_runs" USING btree ("project_id","branch","start_time");