CREATE TABLE `failure_cluster_test_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`test_case_id` integer NOT NULL,
	`cluster_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_cluster_test_routes_project_fingerprint_test` ON `failure_cluster_test_routes` (`project_id`,`fingerprint`,`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_failure_cluster_test_routes_cluster` ON `failure_cluster_test_routes` (`cluster_id`);--> statement-breakpoint
CREATE INDEX `idx_failure_cluster_test_routes_test_case` ON `failure_cluster_test_routes` (`test_case_id`);