ALTER TABLE `projects` ADD `openapi_url` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `server_probes` text;--> statement-breakpoint
ALTER TABLE `scenario_gaps` ADD `snoozed_until` integer;--> statement-breakpoint
ALTER TABLE `scenario_gaps` ADD `snoozed_at_run_id` integer;--> statement-breakpoint
ALTER TABLE `scenario_gaps` ADD `accepted_at` integer;