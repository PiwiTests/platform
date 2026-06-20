PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer,
	`test_runs_case_id` integer,
	`type` text NOT NULL,
	`subtype` text,
	`label` text,
	`path` text NOT NULL,
	`size` integer,
	`blob_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `trace_blobs`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_files`("id", "test_run_id", "test_runs_case_id", "type", "subtype", "label", "path", "size", "blob_id", "created_at") SELECT "id", "test_run_id", "test_runs_case_id", "type", "subtype", "label", "path", "size", "blob_id", "created_at" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_files_test_run_id` ON `files` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_files_test_runs_case_id` ON `files` (`test_runs_case_id`);--> statement-breakpoint
CREATE TABLE `__new_test_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`suite_path` text DEFAULT '' NOT NULL,
	`suite_id` integer,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suite_id`) REFERENCES `test_suites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_test_cases`("id", "project_id", "file_path", "suite_path", "suite_id", "title", "created_at", "updated_at") SELECT "id", "project_id", "file_path", "suite_path", "suite_id", "title", "created_at", "updated_at" FROM `test_cases`;--> statement-breakpoint
DROP TABLE `test_cases`;--> statement-breakpoint
ALTER TABLE `__new_test_cases` RENAME TO `test_cases`;--> statement-breakpoint
CREATE INDEX `idx_test_cases_project_id` ON `test_cases` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_cases_file_path_title` ON `test_cases` (`project_id`,`file_path`,`suite_path`,`title`);--> statement-breakpoint
CREATE TABLE `__new_test_runs` (
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
	`shard_total` integer,
	`shards_finished` integer DEFAULT 0 NOT NULL,
	`environment` text,
	`metadata` text,
	`setup_steps` text,
	`label` text,
	`stream_token` text,
	`instance_id` text,
	`playwright_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_test_runs`("id", "project_id", "status", "start_time", "duration", "total_tests", "passed_tests", "failed_tests", "skipped_tests", "flaky_tests", "avg_test_duration", "p90_test_duration", "shard_total", "shards_finished", "environment", "metadata", "setup_steps", "label", "stream_token", "instance_id", "playwright_version", "created_at", "updated_at") SELECT "id", "project_id", "status", "start_time", "duration", "total_tests", "passed_tests", "failed_tests", "skipped_tests", "flaky_tests", "avg_test_duration", "p90_test_duration", "shard_total", "shards_finished", "environment", "metadata", "setup_steps", "label", "stream_token", "instance_id", "playwright_version", "created_at", "updated_at" FROM `test_runs`;--> statement-breakpoint
DROP TABLE `test_runs`;--> statement-breakpoint
ALTER TABLE `__new_test_runs` RENAME TO `test_runs`;--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_id` ON `test_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_start` ON `test_runs` (`project_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_start_time` ON `test_runs` (`start_time`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD COLUMN `browser_name` text;--> statement-breakpoint
CREATE TABLE `__new_test_runs_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`status` text NOT NULL,
	`duration` integer,
	`error` text,
	`failure_cluster_id` integer,
	`retries` integer DEFAULT 0,
	`line` integer,
	`column` integer,
	`steps` text,
	`step_events` text,
	`slowest_step` text,
	`slowest_step_duration` integer,
	`network_requests` text,
	`web_vitals` text,
	`console_logs` text,
	`aria_snapshot` text,
	`test_source` text,
	`browser` text,
	`browser_name` text,
	`test_annotations` text,
	`worker_index` integer,
	`shard_index` integer,
	`started_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`failure_cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_test_runs_cases`("id", "test_run_id", "test_case_id", "status", "duration", "error", "failure_cluster_id", "retries", "line", "column", "steps", "step_events", "slowest_step", "slowest_step_duration", "network_requests", "web_vitals", "console_logs", "aria_snapshot", "test_source", "browser", "browser_name", "test_annotations", "worker_index", "shard_index", "started_at", "created_at") SELECT "id", "test_run_id", "test_case_id", "status", "duration", "error", "failure_cluster_id", "retries", "line", "column", "steps", "step_events", "slowest_step", "slowest_step_duration", "network_requests", "web_vitals", "console_logs", "aria_snapshot", "test_source", "browser", "browser_name", "test_annotations", "worker_index", "shard_index", "started_at", "created_at" FROM `test_runs_cases`;--> statement-breakpoint
DROP TABLE `test_runs_cases`;--> statement-breakpoint
ALTER TABLE `__new_test_runs_cases` RENAME TO `test_runs_cases`;--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_run_id` ON `test_runs_cases` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_case_id` ON `test_runs_cases` (`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_failure_cluster_id` ON `test_runs_cases` (`failure_cluster_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_runs_cases_run_browser` ON `test_runs_cases` (`test_run_id`,`test_case_id`,`retries`,`browser_name`);--> statement-breakpoint
DROP INDEX `idx_api_keys_key_hash`;--> statement-breakpoint
CREATE INDEX `idx_tags_updated_at` ON `tags` (`updated_at`);
