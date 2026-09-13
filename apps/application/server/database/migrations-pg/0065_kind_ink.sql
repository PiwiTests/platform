CREATE TABLE "integration_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp,
	"error" text,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"requested_by" integer,
	"created_at" timestamp NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"config" jsonb,
	"credentials" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_checked_at" timestamp,
	"last_error" text,
	"managed_by" text DEFAULT 'db' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"project_key" text,
	"issue_type" text,
	"labels" jsonb,
	"default_assignee" text,
	"space_id" text,
	"parent_page_id" text,
	"include" jsonb,
	"policies" jsonb,
	"owner_routes" jsonb,
	"auto_create" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD COLUMN "connection_id" integer;--> statement-breakpoint
ALTER TABLE "entity_links" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "entity_links" ADD COLUMN "origin" text DEFAULT 'pinned' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integration_actions_dedupe" ON "integration_actions" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_integration_actions_project_status" ON "integration_actions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_integration_actions_status" ON "integration_actions" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_integration_actions_connection" ON "integration_actions" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "idx_integration_actions_requested_by" ON "integration_actions" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "idx_integration_connections_provider" ON "integration_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_project_integrations_project" ON "project_integrations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_integrations_connection" ON "project_integrations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_integrations_project_connection" ON "project_integrations" USING btree ("project_id","connection_id");--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entity_links_connection" ON "entity_links" USING btree ("connection_id");