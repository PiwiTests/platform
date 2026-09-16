CREATE TABLE `test_selections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_test_selections_project_id` ON `test_selections` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_test_selections_created_by` ON `test_selections` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_selections_project_key` ON `test_selections` (`project_id`,`key`);