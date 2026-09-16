ALTER TABLE "failure_clusters" ADD COLUMN "last_rerun_dispatch" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ci_rerun" jsonb;