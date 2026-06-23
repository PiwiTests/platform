CREATE TABLE `failure_cluster_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`cluster_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_cluster_aliases_project_fingerprint` ON `failure_cluster_aliases` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_failure_cluster_aliases_cluster` ON `failure_cluster_aliases` (`cluster_id`);--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `embedding` text;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `embedding_model` text;