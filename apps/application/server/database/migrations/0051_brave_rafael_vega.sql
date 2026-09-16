ALTER TABLE `projects` ADD `default_branch` text;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `branch` text;--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_branch_start` ON `test_runs` (`project_id`,`branch`,`start_time`);