CREATE TABLE `cluster_merge_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`cluster_a_id` integer NOT NULL,
	`cluster_b_id` integer NOT NULL,
	`score` real,
	`method` text NOT NULL,
	`llm_confidence` text,
	`llm_reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_a_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_b_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cluster_merge_suggestions_pair` ON `cluster_merge_suggestions` (`cluster_a_id`,`cluster_b_id`);--> statement-breakpoint
CREATE INDEX `idx_cluster_merge_suggestions_project_status` ON `cluster_merge_suggestions` (`project_id`,`status`);