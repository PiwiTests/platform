ALTER TABLE `test_runs` ADD `kept_at` integer;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `kept_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `test_runs` ADD `keep_source` text;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `keep_reason` text;--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_kept` ON `test_runs` (`project_id`,`kept_at`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_kept_by` ON `test_runs` (`kept_by`);