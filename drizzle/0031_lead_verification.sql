CREATE TYPE "public"."lead_verification" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'verification';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "verification" "lead_verification" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "verified_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;