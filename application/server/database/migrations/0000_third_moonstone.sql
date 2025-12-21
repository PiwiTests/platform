CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
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
CREATE INDEX `idx_test_cases_file_path_title` ON `test_cases` (`file_path`,`title`);--> statement-breakpoint
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
	`report_path` text,
	`report_size` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_test_runs_project_id` ON `test_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `test_runs_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`status` text NOT NULL,
	`duration` integer,
	`error` text,
	`retries` integer DEFAULT 0,
	`line` integer,
	`column` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_run_id` ON `test_runs_cases` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_test_case_id` ON `test_runs_cases` (`test_case_id`);--> statement-breakpoint
CREATE TABLE `traces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_runs_case_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_traces_test_runs_case_id` ON `traces` (`test_runs_case_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);