PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_share_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
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
INSERT INTO `__new_share_links`("id", "project_id", "entity_kind", "entity_id", "token_hash", "token_prefix", "created_by", "created_at", "expires_at", "revoked_at", "last_viewed_at", "view_count") SELECT "id", "project_id", "entity_kind", "entity_id", "token_hash", "token_prefix", "created_by", "created_at", "expires_at", "revoked_at", "last_viewed_at", "view_count" FROM `share_links`;--> statement-breakpoint
DROP TABLE `share_links`;--> statement-breakpoint
ALTER TABLE `__new_share_links` RENAME TO `share_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_share_links_project_id` ON `share_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_share_links_entity` ON `share_links` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_share_links_created_by` ON `share_links` (`created_by`);