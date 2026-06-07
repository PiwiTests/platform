CREATE TABLE `trace_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trace_resources_project_name` ON `trace_resources` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `trace_blobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`hash` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trace_blobs_project_hash` ON `trace_blobs` (`project_id`,`hash`);--> statement-breakpoint
ALTER TABLE `files` ADD `blob_id` integer REFERENCES `trace_blobs`(`id`);
