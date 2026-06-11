ALTER TABLE "failure_clusters" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "triage_note" text;--> statement-breakpoint
CREATE INDEX "idx_failure_clusters_status" ON "failure_clusters" USING btree ("status");
