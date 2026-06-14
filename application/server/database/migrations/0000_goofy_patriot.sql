CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_key_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `failure_clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`signature` text NOT NULL,
	`error_type` text,
	`selector` text,
	`sample_error` text,
	`first_seen_run_id` integer NOT NULL,
	`last_seen_run_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`triage_note` text,
	`manual_base_commit` text,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_clusters_project_fingerprint` ON `failure_clusters` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_failure_clusters_project_last_seen` ON `failure_clusters` (`project_id`,`last_seen_run_id`);--> statement-breakpoint
CREATE TABLE `failure_diagnoses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text,
	`model` text,
	`category` text,
	`confidence` text,
	`summary` text,
	`root_cause` text,
	`details` text,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_cluster_id` ON `failure_diagnoses` (`cluster_id`);--> statement-breakpoint
CREATE TABLE `files` (
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
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `trace_blobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_files_test_run_id` ON `files` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_files_test_runs_case_id` ON `files` (`test_runs_case_id`);--> statement-breakpoint
CREATE TABLE `project_tags` (
	`project_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `tag_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_tags_project_id` ON `project_tags` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_tags_tag_id` ON `project_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`description` text,
	`diagnosis_instructions` text,
	`scm_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE INDEX `idx_projects_updated_at` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`color` text DEFAULT 'neutral' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_text_unique` ON `tags` (`text`);--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_test_cases_project_id` ON `test_cases` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_cases_file_path_title` ON `test_cases` (`project_id`,`file_path`,`title`);--> statement-breakpoint
CREATE TABLE `test_runs` (
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
);
--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_id` ON `test_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_start_time` ON `test_runs` (`start_time`);--> statement-breakpoint
CREATE TABLE `test_runs_cases` (
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
	`slowest_step` text,
	`slowest_step_duration` integer,
	`network_requests` text,
	`web_vitals` text,
	`console_logs` text,
	`aria_snapshot` text,
	`test_source` text,
	`browser` text,
	`worker_index` integer,
	`started_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`failure_cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_run_id` ON `test_runs_cases` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_case_id` ON `test_runs_cases` (`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_failure_cluster_id` ON `test_runs_cases` (`failure_cluster_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_runs_cases_run_browser` ON `test_runs_cases` (`test_run_id`,`test_case_id`,`retries`,`browser`);--> statement-breakpoint
CREATE TABLE `trace_blobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`hash` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trace_blobs_project_hash` ON `trace_blobs` (`project_id`,`hash`);--> statement-breakpoint
CREATE TABLE `trace_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trace_resources_project_name` ON `trace_resources` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`oauth_provider` text,
	`oauth_provider_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_oauth` ON `users` (`oauth_provider`,`oauth_provider_id`);