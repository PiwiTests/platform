ALTER TABLE `test_runs` ADD `is_full_run` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `filter_details` text;