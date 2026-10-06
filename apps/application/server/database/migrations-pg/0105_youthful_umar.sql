CREATE TABLE "group_members" (
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"added_by" integer,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"group_id" integer,
	"project_id" integer,
	"role" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "role_bindings_one_subject" CHECK (("role_bindings"."user_id" is not null and "role_bindings"."group_id" is null) or ("role_bindings"."user_id" is null and "role_bindings"."group_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_members_user" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_added_by" ON "group_members" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "idx_groups_created_by" ON "groups" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_bindings_user_all_projects" ON "role_bindings" USING btree ("user_id") WHERE "role_bindings"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_bindings_user_project" ON "role_bindings" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_bindings_group_all_projects" ON "role_bindings" USING btree ("group_id") WHERE "role_bindings"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_bindings_group_project" ON "role_bindings" USING btree ("group_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_role_bindings_project" ON "role_bindings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_role_bindings_created_by" ON "role_bindings" USING btree ("created_by");