CREATE TABLE `heal_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`run_id` integer,
	`dedupe_key` text NOT NULL,
	`kind` text DEFAULT 'open-pr' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error` text,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_heal_actions_dedupe` ON `heal_actions` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_heal_actions_project_status` ON `heal_actions` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_heal_actions_status` ON `heal_actions` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_heal_actions_run` ON `heal_actions` (`run_id`);