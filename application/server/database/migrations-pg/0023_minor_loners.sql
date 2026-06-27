CREATE TABLE "locator_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_case_id" integer NOT NULL,
	"location" text NOT NULL,
	"used_method" text NOT NULL,
	"used_args" text NOT NULL,
	"used_args_fp" text NOT NULL,
	"element_tag" text,
	"element_attrs" text NOT NULL,
	"element_text" text,
	"alternatives" text NOT NULL,
	"last_seen_run_id" integer,
	"last_seen_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locator_snapshots" ADD CONSTRAINT "locator_snapshots_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locator_snapshots" ADD CONSTRAINT "locator_snapshots_last_seen_run_id_test_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_locator_snapshots_location" ON "locator_snapshots" USING btree ("test_case_id","location");--> statement-breakpoint
CREATE INDEX "idx_locator_snapshots_fp" ON "locator_snapshots" USING btree ("test_case_id","used_method","used_args_fp");