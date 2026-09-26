CREATE TABLE `report_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`user_id` integer,
	`scope` text,
	`builtin_dashboard` text,
	`cadence` text NOT NULL,
	`anchor` integer,
	`at` text NOT NULL,
	`comparison` text DEFAULT 'previous' NOT NULL,
	`include_share_link` integer DEFAULT false NOT NULL,
	`language` text,
	`channel_ids` text,
	`active` integer DEFAULT true NOT NULL,
	`muted_until` integer,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_report_schedules_user` ON `report_schedules` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_report_schedules_due` ON `report_schedules` (`active`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `report_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_id` integer,
	`created_by` integer,
	`dashboard_ref` text NOT NULL,
	`dashboard_name` text NOT NULL,
	`scope` text,
	`project_ids` text,
	`period_from` integer NOT NULL,
	`period_to` integer NOT NULL,
	`comparison_from` integer,
	`comparison_to` integer,
	`bundle` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `report_schedules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_report_snapshots_schedule` ON `report_snapshots` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `idx_report_snapshots_generated` ON `report_snapshots` (`generated_at`);--> statement-breakpoint
CREATE INDEX `idx_report_snapshots_created_by` ON `report_snapshots` (`created_by`);