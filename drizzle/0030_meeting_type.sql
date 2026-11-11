CREATE TYPE "public"."meeting_type" AS ENUM('company_office', 'site_visit', 'virtual', 'outdoor', 'sales_event');--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "type" "meeting_type";