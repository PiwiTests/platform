CREATE TABLE "trace_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp NOT NULL
);--> statement-breakpoint
ALTER TABLE "trace_resources" ADD CONSTRAINT "trace_resources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trace_resources_project_name" ON "trace_resources" ("project_id","name");--> statement-breakpoint
CREATE TABLE "trace_blobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"hash" text NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp NOT NULL
);--> statement-breakpoint
ALTER TABLE "trace_blobs" ADD CONSTRAINT "trace_blobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trace_blobs_project_hash" ON "trace_blobs" ("project_id","hash");--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "blob_id" integer;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "trace_blobs"("id") ON DELETE no action ON UPDATE no action;
