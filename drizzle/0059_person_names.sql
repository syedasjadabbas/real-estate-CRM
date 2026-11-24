ALTER TABLE "leads" DROP CONSTRAINT "leads_code_format";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_code_format" CHECK ("leads"."code" ~ '^[A-Z0-9]{8}$');