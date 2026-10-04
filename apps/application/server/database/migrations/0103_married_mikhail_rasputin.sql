CREATE TABLE `mcp_tool_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`api_key_id` integer,
	`user_id` integer,
	`tool` text NOT NULL,
	`subject_type` text,
	`subject_id` integer,
	`result` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_subject` ON `mcp_tool_calls` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_project` ON `mcp_tool_calls` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_created` ON `mcp_tool_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_api_key` ON `mcp_tool_calls` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_user` ON `mcp_tool_calls` (`user_id`);