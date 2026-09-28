ALTER TABLE `entity_links` ADD `bug_report_id` integer REFERENCES bug_reports(id);--> statement-breakpoint
CREATE INDEX `idx_entity_links_bug_report` ON `entity_links` (`bug_report_id`);