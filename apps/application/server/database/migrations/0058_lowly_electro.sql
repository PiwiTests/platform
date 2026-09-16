ALTER TABLE `entity_links` ADD `failure_cluster_id` integer REFERENCES failure_clusters(id);--> statement-breakpoint
CREATE INDEX `idx_entity_links_cluster` ON `entity_links` (`failure_cluster_id`);