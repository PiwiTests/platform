CREATE TABLE `analytics_dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_id` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` integer,
	`last_viewed_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_dashboards_owner` ON `analytics_dashboards` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_analytics_dashboards_visibility` ON `analytics_dashboards` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_analytics_dashboards_updated_by` ON `analytics_dashboards` (`updated_by`);--> statement-breakpoint
ALTER TABLE `report_schedules` ADD `dashboard_id` integer REFERENCES analytics_dashboards(id);--> statement-breakpoint
CREATE INDEX `idx_report_schedules_dashboard` ON `report_schedules` (`dashboard_id`);