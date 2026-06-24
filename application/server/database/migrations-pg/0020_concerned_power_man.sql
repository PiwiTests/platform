CREATE TABLE "cluster_merge_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"cluster_a_id" integer NOT NULL,
	"cluster_b_id" integer NOT NULL,
	"score" double precision,
	"method" text NOT NULL,
	"llm_confidence" text,
	"llm_reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_merge_suggestions" ADD CONSTRAINT "cluster_merge_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_merge_suggestions" ADD CONSTRAINT "cluster_merge_suggestions_cluster_a_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_a_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_merge_suggestions" ADD CONSTRAINT "cluster_merge_suggestions_cluster_b_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_b_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cluster_merge_suggestions_pair" ON "cluster_merge_suggestions" USING btree ("cluster_a_id","cluster_b_id");--> statement-breakpoint
CREATE INDEX "idx_cluster_merge_suggestions_project_status" ON "cluster_merge_suggestions" USING btree ("project_id","status");