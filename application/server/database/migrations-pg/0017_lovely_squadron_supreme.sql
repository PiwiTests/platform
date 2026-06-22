CREATE TABLE "project_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"created_by" integer,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_assignments_user" ON "project_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_project_assignments_project" ON "project_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_assignments_user_project" ON "project_assignments" USING btree ("user_id","project_id");