CREATE TABLE "analytics_dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" integer,
	"visibility" text DEFAULT 'private' NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" integer,
	"last_viewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "dashboard_id" integer;--> statement-breakpoint
ALTER TABLE "analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analytics_dashboards_owner" ON "analytics_dashboards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_dashboards_visibility" ON "analytics_dashboards" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_analytics_dashboards_updated_by" ON "analytics_dashboards" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_dashboard_id_analytics_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."analytics_dashboards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_report_schedules_dashboard" ON "report_schedules" USING btree ("dashboard_id");