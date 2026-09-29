CREATE TABLE `bug_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`page_key` text,
	`path` text,
	`origin` text,
	`status` text DEFAULT 'open' NOT NULL,
	`steps` text NOT NULL,
	`evidence` text NOT NULL,
	`context` text NOT NULL,
	`language` text,
	`created_by` integer,
	`test_case_id` integer,
	`status_run_id` integer,
	`closed_at` integer,
	`closed_by_run_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`status_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_bug_reports_project_status` ON `bug_reports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bug_reports_test_case` ON `bug_reports` (`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_bug_reports_created_by` ON `bug_reports` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_bug_reports_status_run` ON `bug_reports` (`status_run_id`);--> statement-breakpoint
CREATE INDEX `idx_bug_reports_closed_by_run` ON `bug_reports` (`closed_by_run_id`);--> statement-breakpoint
CREATE TABLE `bug_reproductions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bug_report_id` integer NOT NULL,
	`source` text NOT NULL,
	`verdict` text NOT NULL,
	`diverged_at` integer,
	`origin` text,
	`user_agent` text,
	`run_id` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bug_report_id`) REFERENCES `bug_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_bug_reproductions_report` ON `bug_reproductions` (`bug_report_id`);--> statement-breakpoint
CREATE INDEX `idx_bug_reproductions_run` ON `bug_reproductions` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_bug_reproductions_created_by` ON `bug_reproductions` (`created_by`);--> statement-breakpoint
ALTER TABLE `projects` ADD `generated_specs` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `bug_report_id` integer;