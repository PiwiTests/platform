CREATE TABLE "handback_outcome_rollups" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"channel" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handback_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer NOT NULL,
	"suggestion_key" text DEFAULT '' NOT NULL,
	"outcome" text NOT NULL,
	"channel" text NOT NULL,
	"actor_user_id" integer,
	"actor_api_key_id" integer,
	"run_id" integer,
	"commit_sha" text,
	"details" jsonb,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handback_outcome_rollups" ADD CONSTRAINT "handback_outcome_rollups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handback_outcomes" ADD CONSTRAINT "handback_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handback_outcomes" ADD CONSTRAINT "handback_outcomes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handback_outcomes" ADD CONSTRAINT "handback_outcomes_actor_api_key_id_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handback_outcomes" ADD CONSTRAINT "handback_outcomes_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_handback_outcome_rollups_cell" ON "handback_outcome_rollups" USING btree ("project_id","day","kind","outcome","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_handback_outcomes_dedupe" ON "handback_outcomes" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_handback_outcomes_project_kind" ON "handback_outcomes" USING btree ("project_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "idx_handback_outcomes_subject" ON "handback_outcomes" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_handback_outcomes_run" ON "handback_outcomes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_handback_outcomes_actor_user" ON "handback_outcomes" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_handback_outcomes_actor_api_key" ON "handback_outcomes" USING btree ("actor_api_key_id");