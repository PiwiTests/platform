DROP INDEX `idx_test_cases_file_path_title`;--> statement-breakpoint
CREATE INDEX `idx_test_cases_file_path_title` ON `test_cases` (`project_id`,`file_path`,`title`);