-- Custom SQL migration file, put your code below! --

-- Runs stored before the origin column read their origin from metadata, as
-- `runOrigin` (shared/run-eligibility.ts) does: a probe stamp, then a flake-lab
-- stamp, then a `piwiOrigin` whose kind is known (`other` when it is not), then
-- the legacy `import` and `ci` keys, and `local` otherwise.
UPDATE test_runs
SET origin = CASE
	WHEN jsonb_typeof(metadata) <> 'object' THEN 'local'
	WHEN metadata->'piwiProbe' = 'true'::jsonb THEN 'probe'
	WHEN jsonb_typeof(metadata->'piwiFlakeLab') IN ('object', 'array') THEN 'flake-lab'
	WHEN jsonb_typeof(metadata->'piwiOrigin') = 'object' THEN
		CASE
			WHEN jsonb_typeof(metadata->'piwiOrigin'->'kind') = 'string'
				AND metadata->'piwiOrigin'->>'kind' IN ('ci', 'ci-rerun', 'local', 'desktop', 'editor', 'preflight', 'bug', 'flake-lab', 'probe', 'bisect', 'reproduce', 'import')
			THEN metadata->'piwiOrigin'->>'kind'
			ELSE 'other'
		END
	WHEN jsonb_typeof(metadata->'import') = 'object' THEN 'import'
	WHEN jsonb_typeof(metadata->'ci') = 'object' THEN 'ci'
	ELSE 'local'
END
WHERE metadata IS NOT NULL;
