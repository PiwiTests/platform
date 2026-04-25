CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`size` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reports_test_run_id` ON `reports` (`test_run_id`);
