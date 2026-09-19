CREATE TABLE `graph_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`from_kind` text NOT NULL,
	`from_key` text NOT NULL,
	`to_kind` text NOT NULL,
	`to_key` text NOT NULL,
	`kind` text NOT NULL,
	`branch` text,
	`confidence` real,
	`origin` text DEFAULT 'observed' NOT NULL,
	`evidence` text,
	`first_seen_run_id` integer,
	`last_seen_run_id` integer,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_edges_canonical` ON `graph_edges` (`project_id`,`from_kind`,`from_key`,`kind`,`to_kind`,`to_key`) WHERE "graph_edges"."branch" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_edges_branch` ON `graph_edges` (`project_id`,`from_kind`,`from_key`,`kind`,`to_kind`,`to_key`,`branch`) WHERE "graph_edges"."branch" is not null;--> statement-breakpoint
CREATE INDEX `idx_graph_edges_from` ON `graph_edges` (`project_id`,`from_kind`,`from_key`);--> statement-breakpoint
CREATE INDEX `idx_graph_edges_to` ON `graph_edges` (`project_id`,`to_kind`,`to_key`);--> statement-breakpoint
CREATE INDEX `idx_graph_edges_kind` ON `graph_edges` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`branch` text,
	`attrs` text,
	`origin` text DEFAULT 'observed' NOT NULL,
	`usage_30d` integer,
	`first_seen_run_id` integer,
	`last_seen_run_id` integer,
	`pruned_at` integer,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_nodes_canonical` ON `graph_nodes` (`project_id`,`kind`,`key`) WHERE "graph_nodes"."branch" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_nodes_branch` ON `graph_nodes` (`project_id`,`kind`,`key`,`branch`) WHERE "graph_nodes"."branch" is not null;--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_project_kind` ON `graph_nodes` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_project_kind_branch` ON `graph_nodes` (`project_id`,`kind`,`branch`);--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_last_seen_at` ON `graph_nodes` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `scenario_gaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text DEFAULT 'gap' NOT NULL,
	`detector` text NOT NULL,
	`class` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text,
	`factors` text,
	`score` real,
	`feature_node_id` integer,
	`ticket` text,
	`test_case_id` integer,
	`failure_cluster_id` integer,
	`test_run_id` integer,
	`pr_number` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`dismiss_reason` text,
	`assigned_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	`closed_by_run_id` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_node_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`failure_cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_gaps_detector_key` ON `scenario_gaps` (`project_id`,`detector`,`key`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_project_status` ON `scenario_gaps` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_project_score` ON `scenario_gaps` (`project_id`,`score`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_pr` ON `scenario_gaps` (`project_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_feature_node` ON `scenario_gaps` (`feature_node_id`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_test_case` ON `scenario_gaps` (`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_cluster` ON `scenario_gaps` (`failure_cluster_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `route_origins` text;