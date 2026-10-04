CREATE TABLE "trace_blob_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"blob_id" integer NOT NULL,
	"resource_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trace_blobs" ADD COLUMN "resources_indexed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trace_blob_resources" ADD CONSTRAINT "trace_blob_resources_blob_id_trace_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."trace_blobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_blob_resources" ADD CONSTRAINT "trace_blob_resources_resource_id_trace_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."trace_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trace_blob_resources_blob_resource" ON "trace_blob_resources" USING btree ("blob_id","resource_id");--> statement-breakpoint
CREATE INDEX "idx_trace_blob_resources_resource" ON "trace_blob_resources" USING btree ("resource_id");