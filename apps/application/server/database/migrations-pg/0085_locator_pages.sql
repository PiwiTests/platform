DROP INDEX "idx_locator_usages_use";--> statement-breakpoint
ALTER TABLE "locator_usages" ADD COLUMN "page" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "locator_usages" ADD COLUMN "arrival" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "locator_pages_payload_id" integer;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_locator_pages_payload_id_case_payloads_id_fk" FOREIGN KEY ("locator_pages_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trc_locator_pages_payload" ON "test_runs_cases" USING btree ("locator_pages_payload_id") WHERE locator_pages_payload_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_locator_usages_use" ON "locator_usages" USING btree ("test_case_id","browser_name","branch","call_site","action","locator","page");