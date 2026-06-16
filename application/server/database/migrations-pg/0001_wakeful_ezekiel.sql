DROP INDEX "idx_test_cases_file_path_title";--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "suite_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "suite_config" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "test_annotations" jsonb;--> statement-breakpoint
CREATE INDEX "idx_test_cases_file_path_title" ON "test_cases" USING btree ("project_id","file_path","suite_path","title");