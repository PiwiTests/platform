CREATE TABLE "flake_arms" (
	"id" serial PRIMARY KEY NOT NULL,
	"experiment_id" integer NOT NULL,
	"arm_key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"suspect_id" text,
	"label" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"matching_failures" integer DEFAULT 0 NOT NULL,
	"other_failures" integer DEFAULT 0 NOT NULL,
	"discarded_rounds" integer DEFAULT 0 NOT NULL,
	"stopped_early" boolean DEFAULT false NOT NULL,
	"p_value" double precision,
	"verdict" text
);
--> statement-breakpoint
CREATE TABLE "flake_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"kind" text NOT NULL,
	"commit_sha" text,
	"failure_commit_sha" text,
	"source" text DEFAULT 'cli' NOT NULL,
	"machine" text,
	"playwright_project" text,
	"verdict" text,
	"reproducing_arm_id" integer,
	"verifies_arm_id" integer,
	"created_at" timestamp NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "flake_arms" ADD CONSTRAINT "flake_arms_experiment_id_flake_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."flake_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flake_experiments" ADD CONSTRAINT "flake_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flake_experiments" ADD CONSTRAINT "flake_experiments_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_flake_arms_experiment" ON "flake_arms" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "idx_flake_experiments_test_case" ON "flake_experiments" USING btree ("test_case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_flake_experiments_project" ON "flake_experiments" USING btree ("project_id");