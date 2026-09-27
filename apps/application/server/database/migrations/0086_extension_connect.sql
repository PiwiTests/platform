CREATE TABLE `extension_device_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code_hash` text NOT NULL,
	`client_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` integer,
	`api_key_id` integer,
	`interval_seconds` integer DEFAULT 5 NOT NULL,
	`last_polled_at` integer,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_extension_device_codes_device` ON `extension_device_codes` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_extension_device_codes_user` ON `extension_device_codes` (`user_code_hash`);--> statement-breakpoint
CREATE INDEX `idx_extension_device_codes_expires` ON `extension_device_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_extension_device_codes_user_id` ON `extension_device_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_extension_device_codes_api_key` ON `extension_device_codes` (`api_key_id`);--> statement-breakpoint
CREATE TABLE `project_url_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`pattern` text NOT NULL,
	`environment` text,
	`branch` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_url_patterns_pattern` ON `project_url_patterns` (`project_id`,`pattern`);