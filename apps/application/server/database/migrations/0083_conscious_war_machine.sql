DROP INDEX `idx_locator_usages_use`;--> statement-breakpoint
ALTER TABLE `locator_usages` ADD `branch` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_locator_usages_project_branch` ON `locator_usages` (`project_id`,`branch`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locator_usages_use` ON `locator_usages` (`test_case_id`,`browser_name`,`branch`,`call_site`,`action`,`locator`);