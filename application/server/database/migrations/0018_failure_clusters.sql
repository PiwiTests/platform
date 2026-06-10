CREATE TABLE `failure_clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`signature` text NOT NULL,
	`error_type` text,
	`selector` text,
	`sample_error` text,
	`first_seen_run_id` integer NOT NULL,
	`last_seen_run_id` integer NOT NULL,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_clusters_project_fingerprint` ON `failure_clusters` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_failure_clusters_project_last_seen` ON `failure_clusters` (`project_id`,`last_seen_run_id`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `failure_cluster_id` integer REFERENCES failure_clusters(id);--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_failure_cluster_id` ON `test_runs_cases` (`failure_cluster_id`);
