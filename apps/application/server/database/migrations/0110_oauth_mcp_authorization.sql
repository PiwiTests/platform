CREATE TABLE `oauth_authorization_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id_hash` text NOT NULL,
	`client_id` integer NOT NULL,
	`redirect_uri` text NOT NULL,
	`state` text,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` integer,
	`code_hash` text,
	`grant_id` integer,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_authorization_requests_request` ON `oauth_authorization_requests` (`request_id_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_authorization_requests_code` ON `oauth_authorization_requests` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_authorization_requests_client` ON `oauth_authorization_requests` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_authorization_requests_user` ON `oauth_authorization_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_authorization_requests_grant` ON `oauth_authorization_requests` (`grant_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_authorization_requests_expires` ON `oauth_authorization_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_hash` text,
	`client_name` text NOT NULL,
	`client_uri` text,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_clients_client_id` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`api_key_id` integer NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`access_token_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`previous_refresh_token_hash` text,
	`refresh_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`refreshed_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_grants_access` ON `oauth_grants` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_grants_refresh` ON `oauth_grants` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_grants_previous_refresh` ON `oauth_grants` (`previous_refresh_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_grants_api_key` ON `oauth_grants` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_grants_client` ON `oauth_grants` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_grants_user` ON `oauth_grants` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_grants_refresh_expires` ON `oauth_grants` (`refresh_expires_at`);