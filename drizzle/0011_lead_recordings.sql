CREATE TYPE "public"."file_kind" AS ENUM('call_recording', 'document', 'receipt', 'other');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'file_uploaded';--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_sec" integer,
	"sha256" text NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_size_positive" CHECK ("files"."size_bytes" > 0),
	CONSTRAINT "files_duration_range" CHECK ("files"."duration_sec" is null or ("files"."duration_sec" >= 0 and "files"."duration_sec" <= 86400)),
	CONSTRAINT "files_name_length" CHECK (char_length("files"."original_name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_uq" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_lead_created_idx" ON "files" USING btree ("lead_id","created_at");