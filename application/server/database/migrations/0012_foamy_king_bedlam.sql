ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);