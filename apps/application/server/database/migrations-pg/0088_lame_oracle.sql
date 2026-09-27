CREATE TABLE "run_locator_breaks" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"locator" text NOT NULL,
	"rewrite" text,
	"replacements" jsonb,
	"anchor" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"call_sites" jsonb NOT NULL,
	"test_case_ids" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_locator_breaks" ADD CONSTRAINT "run_locator_breaks_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_locator_breaks" ADD CONSTRAINT "run_locator_breaks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_run_locator_breaks_run" ON "run_locator_breaks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_run_locator_breaks_project" ON "run_locator_breaks" USING btree ("project_id");