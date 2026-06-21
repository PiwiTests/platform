ALTER TABLE "network_requests" ADD COLUMN "server_logs" jsonb;--> statement-breakpoint
-- Backfill network_requests from existing JSON column before dropping it
INSERT INTO network_requests (test_runs_case_id, test_run_id, method, url, normalized_url, status, duration, resource_type, server_logs)
SELECT
  trc.id,
  trc.test_run_id,
  value->>'method',
  value->>'url',
  value->>'url',
  (value->>'status')::integer,
  (value->>'duration')::integer,
  value->>'resourceType',
  value->'serverLogs'
FROM test_runs_cases trc, jsonb_array_elements(trc.network_requests) AS value
WHERE trc.network_requests IS NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs_cases" DROP COLUMN "network_requests";