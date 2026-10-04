CREATE TABLE "test_run_resource_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"shard" integer DEFAULT 0 NOT NULL,
	"report" jsonb NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_run_resource_reports" ADD CONSTRAINT "test_run_resource_reports_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_run_resource_reports_run_shard" ON "test_run_resource_reports" USING btree ("run_id","shard");--> statement-breakpoint
ALTER TABLE "test_runs" DROP COLUMN "resource_report";