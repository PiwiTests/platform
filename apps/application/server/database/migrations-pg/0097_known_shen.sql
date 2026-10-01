CREATE TABLE "resource_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"verdict" text NOT NULL,
	"kind" text NOT NULL,
	"place" text NOT NULL,
	"site" text,
	"first_seen_run_id" integer NOT NULL,
	"last_seen_run_id" integer NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"clean_runs" integer DEFAULT 0 NOT NULL,
	"last_checked_run_id" integer,
	"fixed_run_id" integer,
	"fixed_at" timestamp,
	"reopened_run_id" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"branch" text,
	"count" integer DEFAULT 0 NOT NULL,
	"tests" integer DEFAULT 0 NOT NULL,
	"held_ms" integer,
	"after_test_cpu_ms" integer,
	"pages" integer
);
--> statement-breakpoint
ALTER TABLE "resource_findings" ADD CONSTRAINT "resource_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_occurrences" ADD CONSTRAINT "resource_occurrences_finding_id_resource_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."resource_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_occurrences" ADD CONSTRAINT "resource_occurrences_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_resource_findings_project_fingerprint" ON "resource_findings" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_resource_findings_project_status" ON "resource_findings" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_resource_occurrences_finding_run" ON "resource_occurrences" USING btree ("finding_id","run_id");--> statement-breakpoint
CREATE INDEX "idx_resource_occurrences_run" ON "resource_occurrences" USING btree ("run_id");