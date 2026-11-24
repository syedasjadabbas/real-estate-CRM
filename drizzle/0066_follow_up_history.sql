ALTER TYPE "public"."lead_activity_type" ADD VALUE 'follow_up_rescheduled' BEFORE 'assignment';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'follow_up_cancelled' BEFORE 'assignment';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'follow_up_missed' BEFORE 'assignment';--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "missed_at" timestamp with time zone;