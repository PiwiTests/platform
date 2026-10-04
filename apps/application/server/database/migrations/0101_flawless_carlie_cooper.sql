CREATE TABLE `gate_evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`commit_sha` text,
	`pr_number` integer,
	`policy` text NOT NULL,
	`policy_hash` text NOT NULL,
	`passed` integer NOT NULL,
	`verdict` text NOT NULL,
	`violations` text NOT NULL,
	`cluster_ids` text,
	`source` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	`pr_state` text,
	`pr_settled_at` integer,
	`overridden` integer DEFAULT false NOT NULL,
	`escaped_run_id` integer,
	`checked_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`escaped_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_gate_evaluations_run` ON `gate_evaluations` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_gate_evaluations_project_pr` ON `gate_evaluations` (`project_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_gate_evaluations_sweep` ON `gate_evaluations` (`verdict`,`pr_state`,`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_gate_evaluations_escaped_run` ON `gate_evaluations` (`escaped_run_id`);--> statement-breakpoint
CREATE TABLE `pr_feedback_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`provider` text NOT NULL,
	`repository_url` text NOT NULL,
	`pr_number` integer,
	`comment_id` text,
	`statuses` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pr_feedback_posts_run` ON `pr_feedback_posts` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_feedback_posts_project` ON `pr_feedback_posts` (`project_id`,`pr_number`);--> statement-breakpoint
ALTER TABLE `projects` ADD `gate_status` integer DEFAULT false NOT NULL;