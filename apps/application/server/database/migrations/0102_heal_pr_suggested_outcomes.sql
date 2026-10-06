-- Every auto-heal pull request opened so far records its `suggested` hand-back outcome.
INSERT INTO `handback_outcomes` (`project_id`, `kind`, `subject_type`, `subject_id`, `suggestion_key`, `outcome`, `channel`, `run_id`, `dedupe_key`, `created_at`)
SELECT `project_id`, 'auto-heal-pr', 'heal-action', `id`, `dedupe_key`, 'suggested', 'inferred', `run_id`,
  'auto-heal-pr|heal-action:' || CAST(`id` AS TEXT) || '|' || `dedupe_key` || '|suggested|' || COALESCE(CAST(`run_id` AS TEXT), ''),
  `created_at`
FROM `heal_actions`
WHERE `status` IN ('opened', 'merged', 'closed')
ON CONFLICT DO NOTHING;
