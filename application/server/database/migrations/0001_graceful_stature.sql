DROP INDEX `idx_test_cases_file_path_title`;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `suite_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_test_cases_file_path_title` ON `test_cases` (`project_id`,`file_path`,`suite_path`,`title`);