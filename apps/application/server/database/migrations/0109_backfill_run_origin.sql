-- Custom SQL migration file, put your code below! --

-- Runs stored before the origin column read their origin from metadata, as
-- `runOrigin` (shared/run-eligibility.ts) does: a probe stamp, then a flake-lab
-- stamp, then a `piwiOrigin` whose kind is known (`other` when it is not), then
-- the legacy `import` and `ci` keys, and `local` otherwise.
UPDATE test_runs
SET origin = CASE
	WHEN NOT json_valid(metadata) THEN 'local'
	WHEN json_type(metadata) != 'object' THEN 'local'
	WHEN json_type(metadata, '$.piwiProbe') = 'true' THEN 'probe'
	WHEN json_type(metadata, '$.piwiFlakeLab') IN ('object', 'array') THEN 'flake-lab'
	WHEN json_type(metadata, '$.piwiOrigin') = 'object' THEN
		CASE
			WHEN json_type(metadata, '$.piwiOrigin.kind') = 'text'
				AND json_extract(metadata, '$.piwiOrigin.kind') IN ('ci', 'ci-rerun', 'local', 'desktop', 'editor', 'preflight', 'bug', 'flake-lab', 'probe', 'bisect', 'reproduce', 'import')
			THEN json_extract(metadata, '$.piwiOrigin.kind')
			ELSE 'other'
		END
	WHEN json_type(metadata, '$.import') = 'object' THEN 'import'
	WHEN json_type(metadata, '$.ci') = 'object' THEN 'ci'
	ELSE 'local'
END
WHERE metadata IS NOT NULL;
