ALTER TYPE "public"."lead_activity_type" ADD VALUE 'file_deleted';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;