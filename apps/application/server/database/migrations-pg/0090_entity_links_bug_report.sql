ALTER TABLE "entity_links" ADD COLUMN "bug_report_id" integer;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_bug_report_id_bug_reports_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entity_links_bug_report" ON "entity_links" USING btree ("bug_report_id");