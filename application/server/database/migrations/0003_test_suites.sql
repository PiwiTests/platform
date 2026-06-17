CREATE TABLE `test_suites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`suite_path` text NOT NULL,
	`mode` text DEFAULT 'default' NOT NULL,
	`annotations` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_suites_unique` ON `test_suites` (`project_id`,`file_path`,`suite_path`);
--> statement-breakpoint
ALTER TABLE `test_cases` ADD `suite_id` integer REFERENCES `test_suites`(`id`);
--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `test_annotations` text;
--> statement-breakpoint
ALTER TABLE `test_cases` DROP COLUMN `suite_config`;
--> statement-breakpoint
ALTER TABLE `test_cases` DROP COLUMN `test_annotations`;
