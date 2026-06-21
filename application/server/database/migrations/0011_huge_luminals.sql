ALTER TABLE `network_requests` ADD `server_logs` text;--> statement-breakpoint
-- Backfill network_requests from existing JSON column before dropping it
INSERT INTO network_requests (test_runs_case_id, test_run_id, method, url, normalized_url, status, duration, resource_type, server_logs)
SELECT
  trc.id,
  trc.test_run_id,
  json_extract(value, '$.method'),
  json_extract(value, '$.url'),
  json_extract(value, '$.url'),
  json_extract(value, '$.status'),
  json_extract(value, '$.duration'),
  json_extract(value, '$.resourceType'),
  json_extract(value, '$.serverLogs')
FROM test_runs_cases trc, json_each(trc.network_requests)
WHERE trc.network_requests IS NOT NULL;--> statement-breakpoint
ALTER TABLE `test_runs_cases` DROP COLUMN `network_requests`;