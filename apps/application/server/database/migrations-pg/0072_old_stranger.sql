CREATE TABLE "probes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"test_case_id" integer,
	"node_id" integer,
	"route_key" text,
	"level" text DEFAULT 'client' NOT NULL,
	"fault" text NOT NULL,
	"applied" boolean DEFAULT true NOT NULL,
	"outcome" text NOT NULL,
	"handled" text DEFAULT 'n/a' NOT NULL,
	"run_id" integer,
	"evidence" jsonb,
	"probed_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "page_inventory_payload_id" integer;--> statement-breakpoint
ALTER TABLE "probes" ADD CONSTRAINT "probes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probes" ADD CONSTRAINT "probes_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probes" ADD CONSTRAINT "probes_node_id_graph_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_probes_pair" ON "probes" USING btree ("project_id","test_case_id","route_key","fault");--> statement-breakpoint
CREATE INDEX "idx_probes_project" ON "probes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_probes_node" ON "probes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_probes_test" ON "probes" USING btree ("test_case_id");--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_page_inventory_payload_id_case_payloads_id_fk" FOREIGN KEY ("page_inventory_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trc_page_inventory_payload" ON "test_runs_cases" USING btree ("page_inventory_payload_id") WHERE page_inventory_payload_id IS NOT NULL;