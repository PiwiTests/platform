CREATE TABLE "locator_usages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"locator" text NOT NULL,
	"target" text NOT NULL,
	"action" text NOT NULL,
	"browser_name" text NOT NULL,
	"call_site" text NOT NULL,
	"first_seen_run_id" integer,
	"last_seen_run_id" integer,
	"last_seen_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "locator_index_built_at" timestamp;--> statement-breakpoint
ALTER TABLE "locator_usages" ADD CONSTRAINT "locator_usages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locator_usages" ADD CONSTRAINT "locator_usages_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locator_usages" ADD CONSTRAINT "locator_usages_first_seen_run_id_test_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locator_usages" ADD CONSTRAINT "locator_usages_last_seen_run_id_test_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_locator_usages_use" ON "locator_usages" USING btree ("test_case_id","browser_name","call_site","action","locator");--> statement-breakpoint
CREATE INDEX "idx_locator_usages_project_locator" ON "locator_usages" USING btree ("project_id","locator");--> statement-breakpoint
CREATE INDEX "idx_locator_usages_project_target" ON "locator_usages" USING btree ("project_id","target");--> statement-breakpoint
CREATE INDEX "idx_locator_usages_last_seen_run" ON "locator_usages" USING btree ("last_seen_run_id");--> statement-breakpoint
CREATE INDEX "idx_locator_usages_first_seen_run" ON "locator_usages" USING btree ("first_seen_run_id");