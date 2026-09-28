CREATE TABLE "code_reach" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"file" text NOT NULL,
	"origin" text DEFAULT 'client' NOT NULL,
	"last_seen_run_id" integer,
	"last_seen_at" timestamp NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "test_runs_cases" ADD COLUMN "code_reach_payload_id" integer;--> statement-breakpoint
ALTER TABLE "code_reach" ADD CONSTRAINT "code_reach_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reach" ADD CONSTRAINT "code_reach_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reach" ADD CONSTRAINT "code_reach_last_seen_run_id_test_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_locator_breaks" ADD CONSTRAINT "run_locator_breaks_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_locator_breaks" ADD CONSTRAINT "run_locator_breaks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_code_reach_unique" ON "code_reach" USING btree ("test_case_id","branch","file");--> statement-breakpoint
CREATE INDEX "idx_code_reach_project_file" ON "code_reach" USING btree ("project_id","file");--> statement-breakpoint
CREATE INDEX "idx_code_reach_last_seen_run" ON "code_reach" USING btree ("last_seen_run_id");--> statement-breakpoint
CREATE INDEX "idx_run_locator_breaks_run" ON "run_locator_breaks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_run_locator_breaks_project" ON "run_locator_breaks" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_code_reach_payload_id_case_payloads_id_fk" FOREIGN KEY ("code_reach_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trc_code_reach_payload" ON "test_runs_cases" USING btree ("code_reach_payload_id") WHERE code_reach_payload_id IS NOT NULL;