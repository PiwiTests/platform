CREATE TABLE "heal_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"run_id" integer,
	"dedupe_key" text NOT NULL,
	"kind" text DEFAULT 'open-pr' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"scheduled_for" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heal_actions" ADD CONSTRAINT "heal_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_actions" ADD CONSTRAINT "heal_actions_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_heal_actions_dedupe" ON "heal_actions" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_heal_actions_project_status" ON "heal_actions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_heal_actions_status" ON "heal_actions" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_heal_actions_run" ON "heal_actions" USING btree ("run_id");