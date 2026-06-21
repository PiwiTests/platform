DROP INDEX `idx_failure_diagnoses_cluster_id`;--> statement-breakpoint
ALTER TABLE `failure_diagnoses` ADD `scope` text DEFAULT 'cluster' NOT NULL;--> statement-breakpoint
ALTER TABLE `failure_diagnoses` ADD `test_runs_case_id` integer REFERENCES test_runs_cases(id);--> statement-breakpoint
ALTER TABLE `failure_diagnoses` ADD `context_sha` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_cluster_scope` ON `failure_diagnoses` (`cluster_id`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_execution` ON `failure_diagnoses` (`test_runs_case_id`,`scope`);