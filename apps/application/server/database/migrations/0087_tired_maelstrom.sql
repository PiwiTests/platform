CREATE TABLE `run_locator_breaks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`locator` text NOT NULL,
	`rewrite` text,
	`replacements` text,
	`anchor` text NOT NULL,
	`confidence` text NOT NULL,
	`call_sites` text NOT NULL,
	`test_case_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_run_locator_breaks_run` ON `run_locator_breaks` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_run_locator_breaks_project` ON `run_locator_breaks` (`project_id`);