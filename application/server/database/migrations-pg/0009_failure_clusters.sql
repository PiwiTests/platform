CREATE TABLE "failure_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"signature" text NOT NULL,
	"error_type" text,
	"selector" text,
	"sample_error" text,
	"first_seen_run_id" integer NOT NULL,
	"last_seen_run_id" integer NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "failure_cluster_id" integer;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD CONSTRAINT "failure_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_clusters_project_fingerprint" ON "failure_clusters" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_failure_clusters_project_last_seen" ON "failure_clusters" USING btree ("project_id","last_seen_run_id");--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_failure_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("failure_cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_cases_failure_cluster_id" ON "test_runs_cases" USING btree ("failure_cluster_id");
