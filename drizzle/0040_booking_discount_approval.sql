CREATE TYPE "public"."discount_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'discount_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'discount_decided';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_requested_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_status" "discount_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_decided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discount_decided_by_id_users_id_fk" FOREIGN KEY ("discount_decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;