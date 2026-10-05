CREATE TABLE `group_members` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`added_by` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_group_members_user` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_group_members_added_by` ON `group_members` (`added_by`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE INDEX `idx_groups_created_by` ON `groups` (`created_by`);--> statement-breakpoint
CREATE TABLE `role_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`group_id` integer,
	`project_id` integer,
	`role` text NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "role_bindings_one_subject" CHECK(("role_bindings"."user_id" is not null and "role_bindings"."group_id" is null) or ("role_bindings"."user_id" is null and "role_bindings"."group_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_role_bindings_user_all_projects` ON `role_bindings` (`user_id`) WHERE "role_bindings"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_role_bindings_user_project` ON `role_bindings` (`user_id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_role_bindings_group_all_projects` ON `role_bindings` (`group_id`) WHERE "role_bindings"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_role_bindings_group_project` ON `role_bindings` (`group_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_role_bindings_project` ON `role_bindings` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_role_bindings_created_by` ON `role_bindings` (`created_by`);