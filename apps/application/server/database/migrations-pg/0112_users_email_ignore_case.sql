DROP INDEX "idx_users_email";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree (lower("email"));