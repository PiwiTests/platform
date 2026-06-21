CREATE TABLE "failure_diagnosis_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"diagnosis_id" integer NOT NULL,
	"cluster_id" integer NOT NULL,
	"scope" text DEFAULT 'cluster' NOT NULL,
	"test_runs_case_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"provider" text,
	"model" text,
	"category" text,
	"confidence" text,
	"summary" text,
	"root_cause" text,
	"details" jsonb,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"context_sha" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD COLUMN "feedback_note" text;--> statement-breakpoint
ALTER TABLE "failure_diagnosis_versions" ADD CONSTRAINT "failure_diagnosis_versions_diagnosis_id_failure_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."failure_diagnoses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_diagnosis_versions" ADD CONSTRAINT "failure_diagnosis_versions_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_diagnosis_versions" ADD CONSTRAINT "failure_diagnosis_versions_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fdv_diagnosis_id" ON "failure_diagnosis_versions" USING btree ("diagnosis_id");--> statement-breakpoint
CREATE INDEX "idx_fdv_cluster_id" ON "failure_diagnosis_versions" USING btree ("cluster_id");