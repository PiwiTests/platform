CREATE TABLE `network_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_runs_case_id` integer NOT NULL,
	`test_run_id` integer NOT NULL,
	`method` text NOT NULL,
	`url` text,
	`normalized_url` text,
	`status` integer NOT NULL,
	`duration` integer,
	`resource_type` text,
	`content_type` text,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_nr_run` ON `network_requests` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_nr_case` ON `network_requests` (`test_runs_case_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_nr_normalized_url` ON `network_requests` (`normalized_url`);--> statement-breakpoint
-- Convert existing created_at from seconds to milliseconds (§7 timestamp fix)
UPDATE test_runs_cases SET created_at = created_at * 1000 WHERE created_at < 1000000000000;