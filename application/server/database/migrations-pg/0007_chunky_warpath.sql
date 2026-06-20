ALTER TABLE "files" DROP CONSTRAINT "files_test_run_id_test_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_test_runs_case_id_test_runs_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP CONSTRAINT "test_cases_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs" DROP CONSTRAINT "test_runs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs_cases" DROP CONSTRAINT "test_runs_cases_test_run_id_test_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs_cases" DROP CONSTRAINT "test_runs_cases_test_case_id_test_cases_id_fk";
--> statement-breakpoint
DROP INDEX "idx_api_keys_key_hash";--> statement-breakpoint
DROP INDEX "idx_test_runs_cases_run_browser";--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "browser_name" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_start" ON "test_runs" USING btree ("project_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_runs_cases_run_browser" ON "test_runs_cases" USING btree ("test_run_id","test_case_id","retries","browser_name");