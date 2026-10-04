ALTER TABLE "test_runs" ADD COLUMN "kept_at" timestamp;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "kept_by" integer;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "keep_source" text;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "keep_reason" text;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_kept_by_users_id_fk" FOREIGN KEY ("kept_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_kept" ON "test_runs" USING btree ("project_id","kept_at");--> statement-breakpoint
CREATE INDEX "idx_test_runs_kept_by" ON "test_runs" USING btree ("kept_by");