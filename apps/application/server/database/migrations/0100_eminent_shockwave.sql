CREATE TABLE `handback_outcome_rollups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`outcome` text NOT NULL,
	`channel` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_handback_outcome_rollups_cell` ON `handback_outcome_rollups` (`project_id`,`day`,`kind`,`outcome`,`channel`);--> statement-breakpoint
CREATE TABLE `handback_outcomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`suggestion_key` text DEFAULT '' NOT NULL,
	`outcome` text NOT NULL,
	`channel` text NOT NULL,
	`actor_user_id` integer,
	`actor_api_key_id` integer,
	`run_id` integer,
	`commit_sha` text,
	`details` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_handback_outcomes_dedupe` ON `handback_outcomes` (`project_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_handback_outcomes_project_kind` ON `handback_outcomes` (`project_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_handback_outcomes_subject` ON `handback_outcomes` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_handback_outcomes_run` ON `handback_outcomes` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_handback_outcomes_actor_user` ON `handback_outcomes` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `idx_handback_outcomes_actor_api_key` ON `handback_outcomes` (`actor_api_key_id`);