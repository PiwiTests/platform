CREATE INDEX `idx_nr_server_traces` ON `network_requests` (`test_run_id`) WHERE server_traces IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_trc_passed_aria` ON `test_runs_cases` (`test_run_id`) WHERE status = 'passed' AND (aria_snapshot_payload_id IS NOT NULL OR aria_snapshot IS NOT NULL);--> statement-breakpoint
CREATE INDEX `idx_trc_passed_retry` ON `test_runs_cases` (`test_run_id`) WHERE status = 'passed' AND retries > 0;--> statement-breakpoint
CREATE INDEX `idx_trc_skipped` ON `test_runs_cases` (`test_run_id`) WHERE status = 'skipped';