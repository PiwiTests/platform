ALTER TABLE "failure_clusters" ADD COLUMN "snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "snooze_mode" text;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "assignee" text;