CREATE TABLE `entity_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer,
	`test_runs_case_id` integer,
	`test_case_id` integer,
	`url` text NOT NULL,
	`provider` text DEFAULT 'generic' NOT NULL,
	`key` text,
	`title` text,
	`status_text` text,
	`status_color` text,
	`metadata` text,
	`unfurled_at` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_entity_links_run` ON `entity_links` (`test_run_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_case_run` ON `entity_links` (`test_runs_case_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_case` ON `entity_links` (`test_case_id`);