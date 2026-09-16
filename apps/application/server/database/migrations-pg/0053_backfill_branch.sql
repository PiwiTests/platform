-- Older rows predate the scalar branch column and only carry the SCM branch
-- inside metadata JSON; backfill so read paths can rely on the scalar. Rows
-- whose metadata says the literal 'HEAD' (a detached CI checkout, not a branch)
-- stay null rather than recording a fake branch.
UPDATE test_runs
SET branch = metadata->'scm'->>'branch'
WHERE branch IS NULL
	AND metadata IS NOT NULL
	AND metadata->'scm'->>'branch' IS NOT NULL
	AND metadata->'scm'->>'branch' != 'HEAD';
