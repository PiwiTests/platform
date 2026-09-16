CREATE TABLE "share_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_viewed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_share_links_project_id" ON "share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_share_links_entity" ON "share_links" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "idx_share_links_created_by" ON "share_links" USING btree ("created_by");