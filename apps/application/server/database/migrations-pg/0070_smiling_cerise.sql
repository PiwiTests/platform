DROP INDEX "idx_graph_edges_unique";--> statement-breakpoint
DROP INDEX "idx_graph_nodes_project_kind_key";--> statement-breakpoint
ALTER TABLE "graph_edges" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "route_origins" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_edges_canonical" ON "graph_edges" USING btree ("project_id","from_kind","from_key","kind","to_kind","to_key") WHERE "graph_edges"."branch" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_edges_branch" ON "graph_edges" USING btree ("project_id","from_kind","from_key","kind","to_kind","to_key","branch") WHERE "graph_edges"."branch" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_nodes_canonical" ON "graph_nodes" USING btree ("project_id","kind","key") WHERE "graph_nodes"."branch" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_graph_nodes_branch" ON "graph_nodes" USING btree ("project_id","kind","key","branch") WHERE "graph_nodes"."branch" is not null;--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_project_kind_branch" ON "graph_nodes" USING btree ("project_id","kind","branch");