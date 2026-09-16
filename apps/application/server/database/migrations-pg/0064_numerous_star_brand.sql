ALTER TABLE "test_runs_cases" ADD COLUMN "dialogs" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "aria_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "aria_snapshot_json_payload_id" integer;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_aria_snapshot_json_payload_id_case_payloads_id_fk" FOREIGN KEY ("aria_snapshot_json_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trc_aria_json_payload" ON "test_runs_cases" USING btree ("aria_snapshot_json_payload_id") WHERE aria_snapshot_json_payload_id IS NOT NULL;