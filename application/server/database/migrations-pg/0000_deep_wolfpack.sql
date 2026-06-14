CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"signature" text NOT NULL,
	"error_type" text,
	"selector" text,
	"sample_error" text,
	"first_seen_run_id" integer NOT NULL,
	"last_seen_run_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"triage_note" text,
	"manual_base_commit" text,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
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
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_run_id" integer,
	"test_runs_case_id" integer,
	"type" text NOT NULL,
	"subtype" text,
	"label" text,
	"path" text NOT NULL,
	"size" integer,
	"blob_id" integer,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"project_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "project_tags_project_id_tag_id_pk" PRIMARY KEY("project_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"description" text,
	"diagnosis_instructions" text,
	"scm_token" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"color" text DEFAULT 'neutral' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "tags_text_unique" UNIQUE("text")
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"duration" integer,
	"total_tests" integer DEFAULT 0 NOT NULL,
	"passed_tests" integer DEFAULT 0 NOT NULL,
	"failed_tests" integer DEFAULT 0 NOT NULL,
	"skipped_tests" integer DEFAULT 0 NOT NULL,
	"flaky_tests" integer DEFAULT 0 NOT NULL,
	"avg_test_duration" integer,
	"p90_test_duration" integer,
	"environment" text,
	"metadata" jsonb,
	"stream_token" text,
	"instance_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "test_runs_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_run_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"status" text NOT NULL,
	"duration" integer,
	"error" text,
	"failure_cluster_id" integer,
	"retries" integer DEFAULT 0,
	"line" integer,
	"column" integer,
	"steps" jsonb,
	"slowest_step" text,
	"slowest_step_duration" integer,
	"network_requests" jsonb,
	"web_vitals" jsonb,
	"console_logs" jsonb,
	"aria_snapshot" text,
	"test_source" text,
	"browser" jsonb,
	"worker_index" integer,
	"started_at" integer,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_blobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"hash" text NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"oauth_provider" text,
	"oauth_provider_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD CONSTRAINT "failure_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_diagnoses" ADD CONSTRAINT "failure_diagnoses_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_blob_id_trace_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."trace_blobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_failure_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("failure_cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_blobs" ADD CONSTRAINT "trace_blobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_resources" ADD CONSTRAINT "trace_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_keys_user_id" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_key_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_clusters_project_fingerprint" ON "failure_clusters" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_failure_clusters_project_last_seen" ON "failure_clusters" USING btree ("project_id","last_seen_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_diagnoses_cluster_id" ON "failure_diagnoses" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "idx_files_test_run_id" ON "files" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "idx_files_test_runs_case_id" ON "files" USING btree ("test_runs_case_id");--> statement-breakpoint
CREATE INDEX "idx_project_tags_project_id" ON "project_tags" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_tags_tag_id" ON "project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_projects_updated_at" ON "projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_tags_updated_at" ON "tags" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_test_cases_project_id" ON "test_cases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_test_cases_file_path_title" ON "test_cases" USING btree ("project_id","file_path","title");--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_id" ON "test_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_test_runs_start_time" ON "test_runs" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_test_runs_cases_test_run_id" ON "test_runs_cases" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "idx_test_runs_cases_test_case_id" ON "test_runs_cases" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "idx_test_runs_cases_failure_cluster_id" ON "test_runs_cases" USING btree ("failure_cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_runs_cases_run_browser" ON "test_runs_cases" USING btree ("test_run_id","test_case_id","retries","browser");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trace_blobs_project_hash" ON "trace_blobs" USING btree ("project_id","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trace_resources_project_name" ON "trace_resources" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_oauth" ON "users" USING btree ("oauth_provider","oauth_provider_id");