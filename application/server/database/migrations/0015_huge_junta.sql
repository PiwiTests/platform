CREATE TABLE `failure_diagnosis_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnosis_id` integer NOT NULL,
	`cluster_id` integer NOT NULL,
	`scope` text DEFAULT 'cluster' NOT NULL,
	`test_runs_case_id` integer,
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
	`context_sha` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `failure_diagnoses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fdv_diagnosis_id` ON `failure_diagnosis_versions` (`diagnosis_id`);--> statement-breakpoint
CREATE INDEX `idx_fdv_cluster_id` ON `failure_diagnosis_versions` (`cluster_id`);--> statement-breakpoint
ALTER TABLE `failure_diagnoses` ADD `feedback` text;--> statement-breakpoint
ALTER TABLE `failure_diagnoses` ADD `feedback_note` text;