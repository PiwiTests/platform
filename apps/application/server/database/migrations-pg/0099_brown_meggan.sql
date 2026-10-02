ALTER TABLE "failure_clusters" ADD COLUMN "flake_evidence_run_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "quarantine_fails_status" boolean DEFAULT false NOT NULL;