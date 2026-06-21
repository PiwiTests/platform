CREATE TABLE "network_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_runs_case_id" integer NOT NULL,
	"test_run_id" integer NOT NULL,
	"method" text NOT NULL,
	"url" text,
	"normalized_url" text,
	"status" integer NOT NULL,
	"duration" integer,
	"resource_type" text,
	"content_type" text
);
--> statement-breakpoint
ALTER TABLE "network_requests" ADD CONSTRAINT "network_requests_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_requests" ADD CONSTRAINT "network_requests_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_nr_run" ON "network_requests" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "idx_nr_case" ON "network_requests" USING btree ("test_runs_case_id","status");--> statement-breakpoint
CREATE INDEX "idx_nr_normalized_url" ON "network_requests" USING btree ("normalized_url");