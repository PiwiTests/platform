DROP INDEX `idx_locator_usages_use`;--> statement-breakpoint
ALTER TABLE `locator_usages` ADD `page` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `locator_usages` ADD `arrival` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locator_usages_use` ON `locator_usages` (`test_case_id`,`browser_name`,`branch`,`call_site`,`action`,`locator`,`page`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `locator_pages_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
CREATE INDEX `idx_trc_locator_pages_payload` ON `test_runs_cases` (`locator_pages_payload_id`) WHERE locator_pages_payload_id IS NOT NULL;