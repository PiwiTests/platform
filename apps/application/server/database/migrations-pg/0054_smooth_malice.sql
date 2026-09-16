CREATE TABLE "test_selections" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_selections" ADD CONSTRAINT "test_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_selections" ADD CONSTRAINT "test_selections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_selections_project_id" ON "test_selections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_test_selections_created_by" ON "test_selections" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_selections_project_key" ON "test_selections" USING btree ("project_id","key");