CREATE INDEX `idx_scenario_gaps_feature_node` ON `scenario_gaps` (`feature_node_id`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_test_case` ON `scenario_gaps` (`test_case_id`);--> statement-breakpoint
CREATE INDEX `idx_scenario_gaps_cluster` ON `scenario_gaps` (`failure_cluster_id`);