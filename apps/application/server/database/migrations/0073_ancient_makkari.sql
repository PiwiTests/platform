ALTER TABLE `scenario_gaps` ADD `triaged_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `scenario_gaps` ADD `snoozed_at_signature` text;--> statement-breakpoint
ALTER TABLE `scenario_gaps` ADD `covered_at` integer;--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_triaged_by` ON `scenario_gaps` (`triaged_by`);