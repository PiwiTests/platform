-- Custom SQL migration file, put your code below! --

-- The streaming events endpoint counts attempts (a flaky test's failed attempt
-- is one increment) and only /finish collapsed those to distinct-test counts, so
-- runs that never reached a clean finish (interrupted, or an older reporter) kept
-- inflated failed/flaky totals that disagree with the de-duplicated Tests list.
-- Recompute every finished run's counters from its persisted rows: the final
-- attempt per (test case, browser) decides each test's outcome, timed-out folds
-- into failed, and a test that passed only after a retry counts as passed and as
-- flaky. Active runs are left alone so a live run's counters are not clobbered
-- mid-stream, and runs with no persisted cases keep their stored counters.
WITH finals AS (
	SELECT
		test_run_id,
		status,
		retries,
		ROW_NUMBER() OVER (
			PARTITION BY test_run_id, test_case_id, COALESCE(browser_name, '')
			ORDER BY retries DESC, id DESC
		) AS rn
	FROM test_runs_cases
),
counts AS (
	SELECT
		test_run_id,
		COUNT(*) AS total,
		SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
		SUM(CASE WHEN status IN ('failed', 'timedOut', 'timedout') THEN 1 ELSE 0 END) AS failed,
		SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
		SUM(CASE WHEN status = 'didnotrun' THEN 1 ELSE 0 END) AS did_not_run,
		SUM(CASE WHEN status = 'passed' AND retries > 0 THEN 1 ELSE 0 END) AS flaky
	FROM finals
	WHERE rn = 1
	GROUP BY test_run_id
)
UPDATE test_runs
SET
	passed_tests = counts.passed,
	failed_tests = counts.failed,
	skipped_tests = counts.skipped,
	did_not_run_tests = counts.did_not_run,
	flaky_tests = counts.flaky,
	total_tests = GREATEST(test_runs.total_tests, counts.total)
FROM counts
WHERE test_runs.id = counts.test_run_id
	AND test_runs.status NOT IN ('running', 'initializing', 'finalizing');
