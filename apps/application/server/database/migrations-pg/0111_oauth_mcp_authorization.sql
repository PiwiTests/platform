CREATE TABLE "oauth_authorization_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id_hash" text NOT NULL,
	"client_id" integer NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"code_hash" text,
	"grant_id" integer,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"client_uri" text,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"refresh_expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"refreshed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_authorization_requests_request" ON "oauth_authorization_requests" USING btree ("request_id_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_authorization_requests_code" ON "oauth_authorization_requests" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "idx_oauth_authorization_requests_client" ON "oauth_authorization_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_authorization_requests_user" ON "oauth_authorization_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_authorization_requests_grant" ON "oauth_authorization_requests" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_authorization_requests_expires" ON "oauth_authorization_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_clients_client_id" ON "oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_grants_access" ON "oauth_grants" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_grants_refresh" ON "oauth_grants" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "idx_oauth_grants_previous_refresh" ON "oauth_grants" USING btree ("previous_refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oauth_grants_api_key" ON "oauth_grants" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_grants_client" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_grants_user" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_grants_refresh_expires" ON "oauth_grants" USING btree ("refresh_expires_at");