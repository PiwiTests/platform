CREATE TABLE `code_reach` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`branch` text DEFAULT '' NOT NULL,
	`file` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`last_seen_run_id` integer,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_seen_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_code_reach_unique` ON `code_reach` (`test_case_id`,`branch`,`file`);--> statement-breakpoint
CREATE INDEX `idx_code_reach_project_file` ON `code_reach` (`project_id`,`file`);--> statement-breakpoint
CREATE INDEX `idx_code_reach_last_seen_run` ON `code_reach` (`last_seen_run_id`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `code_reach_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
CREATE INDEX `idx_trc_code_reach_payload` ON `test_runs_cases` (`code_reach_payload_id`) WHERE code_reach_payload_id IS NOT NULL;