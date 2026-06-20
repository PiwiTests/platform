CREATE TABLE "entity_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_run_id" integer,
	"test_runs_case_id" integer,
	"test_case_id" integer,
	"url" text NOT NULL,
	"provider" text DEFAULT 'generic' NOT NULL,
	"key" text,
	"title" text,
	"status_text" text,
	"status_color" text,
	"metadata" jsonb,
	"unfurled_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_test_runs_case_id_test_runs_cases_id_fk" FOREIGN KEY ("test_runs_case_id") REFERENCES "public"."test_runs_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entity_links_run" ON "entity_links" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "idx_entity_links_case_run" ON "entity_links" USING btree ("test_runs_case_id");--> statement-breakpoint
CREATE INDEX "idx_entity_links_case" ON "entity_links" USING btree ("test_case_id");