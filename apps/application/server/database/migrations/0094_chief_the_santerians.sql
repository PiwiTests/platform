CREATE TABLE `flake_arms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_id` integer NOT NULL,
	`arm_key` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`suspect_id` text,
	`label` text NOT NULL,
	`conditions` text NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`matching_failures` integer DEFAULT 0 NOT NULL,
	`other_failures` integer DEFAULT 0 NOT NULL,
	`discarded_rounds` integer DEFAULT 0 NOT NULL,
	`stopped_early` integer DEFAULT false NOT NULL,
	`p_value` real,
	`verdict` text,
	FOREIGN KEY (`experiment_id`) REFERENCES `flake_experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flake_arms_experiment` ON `flake_arms` (`experiment_id`);--> statement-breakpoint
CREATE TABLE `flake_experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`kind` text NOT NULL,
	`commit_sha` text,
	`failure_commit_sha` text,
	`source` text DEFAULT 'cli' NOT NULL,
	`machine` text,
	`playwright_project` text,
	`verdict` text,
	`reproducing_arm_id` integer,
	`verifies_arm_id` integer,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flake_experiments_test_case` ON `flake_experiments` (`test_case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_flake_experiments_project` ON `flake_experiments` (`project_id`);