CREATE TABLE "failure_cluster_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"cluster_id" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "embedding" text;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "failure_cluster_aliases" ADD CONSTRAINT "failure_cluster_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_cluster_aliases" ADD CONSTRAINT "failure_cluster_aliases_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_cluster_aliases_project_fingerprint" ON "failure_cluster_aliases" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_failure_cluster_aliases_cluster" ON "failure_cluster_aliases" USING btree ("cluster_id");