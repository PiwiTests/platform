CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_diagnoses" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider" text,
	"model" text,
	"category" text,
	"confidence" text,
	"summary" text,
	"root_cause" text,
	"details" jsonb,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD CONSTRAINT "failure_diagnoses_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_diagnoses_cluster_id" ON "failure_diagnoses" USING btree ("cluster_id");