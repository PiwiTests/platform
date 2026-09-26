CREATE TABLE "analytics_daily_rollups" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"day" text NOT NULL,
	"environment" text DEFAULT '' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"full_run" integer NOT NULL,
	"part" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"passed_runs" integer DEFAULT 0 NOT NULL,
	"failed_runs" integer DEFAULT 0 NOT NULL,
	"total_tests" integer DEFAULT 0 NOT NULL,
	"passed_tests" integer DEFAULT 0 NOT NULL,
	"failed_tests" integer DEFAULT 0 NOT NULL,
	"skipped_tests" integer DEFAULT 0 NOT NULL,
	"did_not_run_tests" integer DEFAULT 0 NOT NULL,
	"flaky_tests" integer DEFAULT 0 NOT NULL,
	"max_total_tests" integer DEFAULT 0 NOT NULL,
	"duration_ms" bigint DEFAULT 0 NOT NULL,
	"avg_test_duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"p90_test_duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"wait_ms" bigint DEFAULT 0 NOT NULL,
	"failed_exec_ms" bigint DEFAULT 0 NOT NULL,
	"new_regressions" integer DEFAULT 0 NOT NULL,
	"new_flaky" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily_rollups" ADD CONSTRAINT "analytics_daily_rollups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_analytics_daily_rollups_cell" ON "analytics_daily_rollups" USING btree ("project_id","day","environment","branch","full_run","part");--> statement-breakpoint
CREATE INDEX "idx_analytics_daily_rollups_project_day" ON "analytics_daily_rollups" USING btree ("project_id","day");