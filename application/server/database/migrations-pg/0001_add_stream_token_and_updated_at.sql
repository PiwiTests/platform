ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "stream_token" text;
--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
