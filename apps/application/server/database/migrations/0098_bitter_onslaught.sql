ALTER TABLE `failure_clusters` ADD `flake_evidence_run_id` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `quarantine_fails_status` integer DEFAULT false NOT NULL;