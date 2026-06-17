CREATE TABLE "test_suites" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"suite_path" text NOT NULL,
	"mode" text DEFAULT 'default' NOT NULL,
	"annotations" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "suite_id" integer;
--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "test_annotations" jsonb;
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN "suite_config";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN "test_annotations";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_suites_unique" ON "test_suites" USING btree ("project_id","file_path","suite_path");
--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;
