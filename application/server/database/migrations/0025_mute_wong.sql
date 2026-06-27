CREATE TABLE `locator_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_case_id` integer NOT NULL,
	`location` text NOT NULL,
	`used_method` text NOT NULL,
	`used_args` text NOT NULL,
	`used_args_fp` text NOT NULL,
	`element_tag` text,
	`element_attrs` text NOT NULL,
	`element_text` text,
	`alternatives` text NOT NULL,
	`last_seen_run_id` integer,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_seen_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locator_snapshots_location` ON `locator_snapshots` (`test_case_id`,`location`);--> statement-breakpoint
CREATE INDEX `idx_locator_snapshots_fp` ON `locator_snapshots` (`test_case_id`,`used_method`,`used_args_fp`);