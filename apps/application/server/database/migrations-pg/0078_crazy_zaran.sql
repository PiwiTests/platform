CREATE TABLE "report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" integer,
	"scope" jsonb,
	"builtin_dashboard" text,
	"cadence" text NOT NULL,
	"anchor" integer,
	"at" text NOT NULL,
	"comparison" text DEFAULT 'previous' NOT NULL,
	"include_share_link" integer DEFAULT 0 NOT NULL,
	"language" text,
	"channel_ids" jsonb,
	"active" integer DEFAULT 1 NOT NULL,
	"muted_until" timestamp,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer,
	"created_by" integer,
	"dashboard_ref" text NOT NULL,
	"dashboard_name" text NOT NULL,
	"scope" jsonb,
	"project_ids" jsonb,
	"period_from" timestamp NOT NULL,
	"period_to" timestamp NOT NULL,
	"comparison_from" timestamp,
	"comparison_to" timestamp,
	"bundle" jsonb NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_report_schedules_user" ON "report_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_report_schedules_due" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_report_snapshots_schedule" ON "report_snapshots" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_report_snapshots_generated" ON "report_snapshots" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "idx_report_snapshots_created_by" ON "report_snapshots" USING btree ("created_by");