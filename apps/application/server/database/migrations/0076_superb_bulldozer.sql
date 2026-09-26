CREATE TABLE `analytics_daily_rollups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`environment` text DEFAULT '' NOT NULL,
	`branch` text DEFAULT '' NOT NULL,
	`full_run` integer NOT NULL,
	`part` text NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`passed_runs` integer DEFAULT 0 NOT NULL,
	`failed_runs` integer DEFAULT 0 NOT NULL,
	`total_tests` integer DEFAULT 0 NOT NULL,
	`passed_tests` integer DEFAULT 0 NOT NULL,
	`failed_tests` integer DEFAULT 0 NOT NULL,
	`skipped_tests` integer DEFAULT 0 NOT NULL,
	`did_not_run_tests` integer DEFAULT 0 NOT NULL,
	`flaky_tests` integer DEFAULT 0 NOT NULL,
	`max_total_tests` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`avg_test_duration_sum_ms` integer DEFAULT 0 NOT NULL,
	`p90_test_duration_sum_ms` integer DEFAULT 0 NOT NULL,
	`wait_ms` integer DEFAULT 0 NOT NULL,
	`failed_exec_ms` integer DEFAULT 0 NOT NULL,
	`new_regressions` integer DEFAULT 0 NOT NULL,
	`new_flaky` integer DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_analytics_daily_rollups_cell` ON `analytics_daily_rollups` (`project_id`,`day`,`environment`,`branch`,`full_run`,`part`);--> statement-breakpoint
CREATE INDEX `idx_analytics_daily_rollups_project_day` ON `analytics_daily_rollups` (`project_id`,`day`);