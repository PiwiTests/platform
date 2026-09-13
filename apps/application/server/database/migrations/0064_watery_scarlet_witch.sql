CREATE TABLE `integration_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`scheduled_for` integer,
	`error` text,
	`payload` text NOT NULL,
	`result` text,
	`requested_by` integer,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_actions_dedupe` ON `integration_actions` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_integration_actions_project_status` ON `integration_actions` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_integration_actions_status` ON `integration_actions` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_integration_actions_connection` ON `integration_actions` (`connection_id`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`config` text,
	`credentials` text,
	`status` text DEFAULT 'unverified' NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`managed_by` text DEFAULT 'db' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_integration_connections_provider` ON `integration_connections` (`provider`);--> statement-breakpoint
CREATE TABLE `project_integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`project_key` text,
	`issue_type` text,
	`labels` text,
	`default_assignee` text,
	`space_id` text,
	`parent_page_id` text,
	`include` text,
	`policies` text,
	`owner_routes` text,
	`auto_create` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_integrations_project` ON `project_integrations` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_integrations_connection` ON `project_integrations` (`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_integrations_project_connection` ON `project_integrations` (`project_id`,`connection_id`);--> statement-breakpoint
ALTER TABLE `entity_links` ADD `connection_id` integer REFERENCES integration_connections(id);--> statement-breakpoint
ALTER TABLE `entity_links` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `entity_links` ADD `origin` text DEFAULT 'pinned' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_entity_links_connection` ON `entity_links` (`connection_id`);