CREATE TABLE `trace_blob_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`blob_id` integer NOT NULL,
	`resource_id` integer NOT NULL,
	FOREIGN KEY (`blob_id`) REFERENCES `trace_blobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `trace_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trace_blob_resources_blob_resource` ON `trace_blob_resources` (`blob_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_trace_blob_resources_resource` ON `trace_blob_resources` (`resource_id`);--> statement-breakpoint
ALTER TABLE `trace_blobs` ADD `resources_indexed` integer DEFAULT false NOT NULL;