DROP INDEX "idx_failure_diagnoses_cluster_id";--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD COLUMN "scope" text DEFAULT 'cluster' NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD COLUMN "test_runs_case_id" integer;--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD COLUMN "context_sha" text;--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD CONSTRAINT "failure_diagnoses_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_diagnoses_execution_scope" ON "failure_diagnoses" USING btree ("test_runs_case_id","scope");