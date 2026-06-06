DROP TABLE IF EXISTS `traces`;--> statement-breakpoint
DROP TABLE IF EXISTS `reports`;--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer,
	`test_runs_case_id` integer,
	`type` text NOT NULL,
	`subtype` text,
	`label` text,
	`path` text NOT NULL,
	`size` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_files_test_run_id` ON `files` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_files_test_runs_case_id` ON `files` (`test_runs_case_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `test_runs_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`status` text NOT NULL,
	`start_time` integer NOT NULL,
	`duration` integer,
	`total_tests` integer DEFAULT 0 NOT NULL,
	`passed_tests` integer DEFAULT 0 NOT NULL,
	`failed_tests` integer DEFAULT 0 NOT NULL,
	`skipped_tests` integer DEFAULT 0 NOT NULL,
	`flaky_tests` integer DEFAULT 0 NOT NULL,
	`avg_test_duration` integer,
	`p90_test_duration` integer,
	`environment` text,
	`metadata` text,
	`stream_token` text,
	`instance_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `test_runs_new` (`id`, `project_id`, `status`, `start_time`, `duration`, `total_tests`, `passed_tests`, `failed_tests`, `skipped_tests`, `flaky_tests`, `avg_test_duration`, `p90_test_duration`, `environment`, `metadata`, `stream_token`, `instance_id`, `created_at`, `updated_at`)
SELECT `id`, `project_id`, `status`, `start_time`, `duration`, `total_tests`, `passed_tests`, `failed_tests`, `skipped_tests`, `flaky_tests`, NULL, NULL, `environment`, `metadata`, `stream_token`, `instance_id`, `created_at`, `updated_at`
FROM `test_runs`;--> statement-breakpoint
DROP TABLE `test_runs`;--> statement-breakpoint
ALTER TABLE `test_runs_new` RENAME TO `test_runs`;--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_id` ON `test_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_start_time` ON `test_runs` (`start_time`);