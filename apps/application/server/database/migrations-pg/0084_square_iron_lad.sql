DROP INDEX "idx_locator_usages_use";--> statement-breakpoint
ALTER TABLE "locator_usages" ADD COLUMN "branch" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_locator_usages_project_branch" ON "locator_usages" USING btree ("project_id","branch");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_locator_usages_use" ON "locator_usages" USING btree ("test_case_id","browser_name","branch","call_site","action","locator");