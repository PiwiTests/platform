CREATE TABLE "gate_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"commit_sha" text,
	"pr_number" integer,
	"policy" jsonb NOT NULL,
	"policy_hash" text NOT NULL,
	"passed" boolean NOT NULL,
	"verdict" text NOT NULL,
	"violations" jsonb NOT NULL,
	"cluster_ids" jsonb,
	"source" text NOT NULL,
	"evaluated_at" timestamp NOT NULL,
	"pr_state" text,
	"pr_settled_at" timestamp,
	"overridden" boolean DEFAULT false NOT NULL,
	"escaped_run_id" integer,
	"checked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pr_feedback_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"provider" text NOT NULL,
	"repository_url" text NOT NULL,
	"pr_number" integer,
	"comment_id" text,
	"statuses" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "gate_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_escaped_run_id_test_runs_id_fk" FOREIGN KEY ("escaped_run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_feedback_posts" ADD CONSTRAINT "pr_feedback_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_feedback_posts" ADD CONSTRAINT "pr_feedback_posts_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gate_evaluations_run" ON "gate_evaluations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_gate_evaluations_project_pr" ON "gate_evaluations" USING btree ("project_id","pr_number");--> statement-breakpoint
CREATE INDEX "idx_gate_evaluations_sweep" ON "gate_evaluations" USING btree ("verdict","pr_state","checked_at");--> statement-breakpoint
CREATE INDEX "idx_gate_evaluations_escaped_run" ON "gate_evaluations" USING btree ("escaped_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pr_feedback_posts_run" ON "pr_feedback_posts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_pr_feedback_posts_project" ON "pr_feedback_posts" USING btree ("project_id","pr_number");