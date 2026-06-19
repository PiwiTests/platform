ALTER TABLE `test_runs` ADD `shard_total` integer;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `shards_finished` integer DEFAULT 0 NOT NULL;