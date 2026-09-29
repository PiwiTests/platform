CREATE TABLE "extension_device_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code_hash" text NOT NULL,
	"client_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"api_key_id" integer,
	"interval_seconds" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_url_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"pattern" text NOT NULL,
	"environment" text,
	"branch" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_device_codes" ADD CONSTRAINT "extension_device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_device_codes" ADD CONSTRAINT "extension_device_codes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_url_patterns" ADD CONSTRAINT "project_url_patterns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_extension_device_codes_device" ON "extension_device_codes" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_extension_device_codes_user" ON "extension_device_codes" USING btree ("user_code_hash");--> statement-breakpoint
CREATE INDEX "idx_extension_device_codes_expires" ON "extension_device_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_extension_device_codes_user_id" ON "extension_device_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_extension_device_codes_api_key" ON "extension_device_codes" USING btree ("api_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_url_patterns_pattern" ON "project_url_patterns" USING btree ("project_id","pattern");