CREATE TABLE `test_run_resource_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`shard` integer DEFAULT 0 NOT NULL,
	`report` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_run_resource_reports_run_shard` ON `test_run_resource_reports` (`run_id`,`shard`);--> statement-breakpoint
ALTER TABLE `test_runs` DROP COLUMN `resource_report`;