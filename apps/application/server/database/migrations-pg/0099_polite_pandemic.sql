CREATE TABLE "failure_cluster_test_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"test_case_id" integer NOT NULL,
	"cluster_id" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_cluster_test_routes" ADD CONSTRAINT "failure_cluster_test_routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_cluster_test_routes" ADD CONSTRAINT "failure_cluster_test_routes_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_cluster_test_routes" ADD CONSTRAINT "failure_cluster_test_routes_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_cluster_test_routes_project_fingerprint_test" ON "failure_cluster_test_routes" USING btree ("project_id","fingerprint","test_case_id");--> statement-breakpoint
CREATE INDEX "idx_failure_cluster_test_routes_cluster" ON "failure_cluster_test_routes" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "idx_failure_cluster_test_routes_test_case" ON "failure_cluster_test_routes" USING btree ("test_case_id");