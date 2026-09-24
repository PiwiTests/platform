CREATE TABLE `locator_usages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`locator` text NOT NULL,
	`target` text NOT NULL,
	`action` text NOT NULL,
	`browser_name` text NOT NULL,
	`call_site` text NOT NULL,
	`first_seen_run_id` integer,
	`last_seen_run_id` integer,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_seen_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_seen_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locator_usages_use` ON `locator_usages` (`test_case_id`,`browser_name`,`call_site`,`action`,`locator`);--> statement-breakpoint
CREATE INDEX `idx_locator_usages_project_locator` ON `locator_usages` (`project_id`,`locator`);--> statement-breakpoint
CREATE INDEX `idx_locator_usages_project_target` ON `locator_usages` (`project_id`,`target`);--> statement-breakpoint
CREATE INDEX `idx_locator_usages_last_seen_run` ON `locator_usages` (`last_seen_run_id`);--> statement-breakpoint
CREATE INDEX `idx_locator_usages_first_seen_run` ON `locator_usages` (`first_seen_run_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `locator_index_built_at` integer;