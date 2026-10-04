CREATE TABLE "mcp_tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"api_key_id" integer,
	"user_id" integer,
	"tool" text NOT NULL,
	"subject_type" text,
	"subject_id" integer,
	"result" text NOT NULL,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_calls_subject" ON "mcp_tool_calls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_calls_project" ON "mcp_tool_calls" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_calls_created" ON "mcp_tool_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_calls_api_key" ON "mcp_tool_calls" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_calls_user" ON "mcp_tool_calls" USING btree ("user_id");