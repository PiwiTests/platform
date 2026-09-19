CREATE TABLE "graph_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"from_kind" text NOT NULL,
	"from_key" text NOT NULL,
	"to_kind" text NOT NULL,
	"to_key" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" double precision,
	"origin" text DEFAULT 'observed' NOT NULL,
	"evidence" jsonb,
	"first_seen_run_id" integer,
	"last_seen_run_id" integer,
	"last_seen_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"attrs" jsonb,
	"origin" text DEFAULT 'observed' NOT NULL,
	"usage_30d" integer,
	"first_seen_run_id" integer,
	"last_seen_run_id" integer,
	"last_seen_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text DEFAULT 'gap' NOT NULL,
	"detector" text NOT NULL,
	"class" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb,
	"factors" jsonb,
	"score" double precision,
	"feature_node_id" integer,
	"ticket" text,
	"test_case_id" integer,
	"failure_cluster_id" integer,
	"test_run_id" integer,
	"pr_number" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"dismiss_reason" text,
	"assigned_to" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"closed_by_run_id" integer
);
--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD CONSTRAINT "scenario_gaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD CONSTRAINT "scenario_gaps_feature_node_id_graph_nodes_id_fk" FOREIGN KEY ("feature_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD CONSTRAINT "scenario_gaps_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD CONSTRAINT "scenario_gaps_failure_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("failure_cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_edges_unique" ON "graph_edges" USING btree ("project_id","from_kind","from_key","kind","to_kind","to_key");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_from" ON "graph_edges" USING btree ("project_id","from_kind","from_key");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_to" ON "graph_edges" USING btree ("project_id","to_kind","to_key");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_kind" ON "graph_edges" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_nodes_project_kind_key" ON "graph_nodes" USING btree ("project_id","kind","key");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_project_kind" ON "graph_nodes" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_last_seen_at" ON "graph_nodes" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_scenario_gaps_detector_key" ON "scenario_gaps" USING btree ("project_id","detector","key");--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_project_status" ON "scenario_gaps" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_project_score" ON "scenario_gaps" USING btree ("project_id","score");--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_pr" ON "scenario_gaps" USING btree ("project_id","pr_number");