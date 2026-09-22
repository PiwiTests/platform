CREATE TABLE `probes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`test_case_id` integer,
	`node_id` integer,
	`route_key` text,
	`level` text DEFAULT 'client' NOT NULL,
	`fault` text NOT NULL,
	`applied` integer DEFAULT true NOT NULL,
	`outcome` text NOT NULL,
	`handled` text DEFAULT 'n/a' NOT NULL,
	`run_id` integer,
	`evidence` text,
	`probed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`node_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_probes_pair` ON `probes` (`project_id`,`test_case_id`,`route_key`,`fault`);--> statement-breakpoint
CREATE INDEX `idx_probes_project` ON `probes` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_probes_node` ON `probes` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_probes_test` ON `probes` (`test_case_id`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `page_inventory_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
CREATE INDEX `idx_trc_page_inventory_payload` ON `test_runs_cases` (`page_inventory_payload_id`) WHERE page_inventory_payload_id IS NOT NULL;