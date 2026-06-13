CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `failure_diagnoses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text,
	`model` text,
	`category` text,
	`confidence` text,
	`summary` text,
	`root_cause` text,
	`details` text,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_cluster_id` ON `failure_diagnoses` (`cluster_id`);