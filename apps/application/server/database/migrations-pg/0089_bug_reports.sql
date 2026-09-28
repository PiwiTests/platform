CREATE TABLE "bug_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"page_key" text,
	"path" text,
	"origin" text,
	"status" text DEFAULT 'open' NOT NULL,
	"steps" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"language" text,
	"created_by" integer,
	"test_case_id" integer,
	"status_run_id" integer,
	"closed_at" timestamp,
	"closed_by_run_id" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reproductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"bug_report_id" integer NOT NULL,
	"source" text NOT NULL,
	"verdict" text NOT NULL,
	"diverged_at" integer,
	"origin" text,
	"user_agent" text,
	"run_id" integer,
	"created_by" integer,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "generated_specs" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "bug_report_id" integer;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_status_run_id_test_runs_id_fk" FOREIGN KEY ("status_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_closed_by_run_id_test_runs_id_fk" FOREIGN KEY ("closed_by_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reproductions" ADD CONSTRAINT "bug_reproductions_bug_report_id_bug_reports_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reproductions" ADD CONSTRAINT "bug_reproductions_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reproductions" ADD CONSTRAINT "bug_reproductions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bug_reports_project_status" ON "bug_reports" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_bug_reports_test_case" ON "bug_reports" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "idx_bug_reports_created_by" ON "bug_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_bug_reports_status_run" ON "bug_reports" USING btree ("status_run_id");--> statement-breakpoint
CREATE INDEX "idx_bug_reports_closed_by_run" ON "bug_reports" USING btree ("closed_by_run_id");--> statement-breakpoint
CREATE INDEX "idx_bug_reproductions_report" ON "bug_reproductions" USING btree ("bug_report_id");--> statement-breakpoint
CREATE INDEX "idx_bug_reproductions_run" ON "bug_reproductions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_bug_reproductions_created_by" ON "bug_reproductions" USING btree ("created_by");