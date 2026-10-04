CREATE TABLE `resource_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`verdict` text NOT NULL,
	`kind` text NOT NULL,
	`place` text NOT NULL,
	`site` text,
	`first_seen_run_id` integer NOT NULL,
	`last_seen_run_id` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`clean_runs` integer DEFAULT 0 NOT NULL,
	`last_checked_run_id` integer,
	`fixed_run_id` integer,
	`fixed_at` integer,
	`reopened_run_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_resource_findings_project_fingerprint` ON `resource_findings` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_resource_findings_project_status` ON `resource_findings` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `resource_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`finding_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`branch` text,
	`count` integer DEFAULT 0 NOT NULL,
	`tests` integer DEFAULT 0 NOT NULL,
	`held_ms` integer,
	`after_test_cpu_ms` integer,
	`pages` integer,
	FOREIGN KEY (`finding_id`) REFERENCES `resource_findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_resource_occurrences_finding_run` ON `resource_occurrences` (`finding_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_occurrences_run` ON `resource_occurrences` (`run_id`);