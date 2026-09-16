CREATE TABLE `share_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_share_links_project_id` ON `share_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_share_links_entity` ON `share_links` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_share_links_created_by` ON `share_links` (`created_by`);