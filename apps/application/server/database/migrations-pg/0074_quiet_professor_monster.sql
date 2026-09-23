ALTER TABLE "scenario_gaps" ADD COLUMN "triaged_by" integer;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD COLUMN "snoozed_at_signature" text;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD COLUMN "covered_at" timestamp;--> statement-breakpoint
ALTER TABLE "scenario_gaps" ADD CONSTRAINT "scenario_gaps_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scenario_gaps_triaged_by" ON "scenario_gaps" USING btree ("triaged_by");