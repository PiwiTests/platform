ALTER TABLE `failure_clusters` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `triage_note` text;--> statement-breakpoint
CREATE INDEX `idx_failure_clusters_status` ON `failure_clusters` (`status`);
