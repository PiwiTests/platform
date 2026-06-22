CREATE TABLE `project_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_assignments_user` ON `project_assignments` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_project_assignments_project` ON `project_assignments` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_assignments_user_project` ON `project_assignments` (`user_id`,`project_id`);