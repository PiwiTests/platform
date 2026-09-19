CREATE INDEX "idx_scenario_gaps_feature_node" ON "scenario_gaps" USING btree ("feature_node_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_test_case" ON "scenario_gaps" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_cluster" ON "scenario_gaps" USING btree ("failure_cluster_id");