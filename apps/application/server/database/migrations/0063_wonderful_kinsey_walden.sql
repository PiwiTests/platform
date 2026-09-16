ALTER TABLE `test_runs_cases` ADD `dialogs` text;--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `aria_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `aria_snapshot_json_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
CREATE INDEX `idx_trc_aria_json_payload` ON `test_runs_cases` (`aria_snapshot_json_payload_id`) WHERE aria_snapshot_json_payload_id IS NOT NULL;