ALTER TABLE "employee_profiles" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_identity" CHECK ("employee_profiles"."user_id" is not null or ("employee_profiles"."full_name" is not null and length(btrim("employee_profiles"."full_name")) > 0));--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_record_lengths" CHECK (coalesce(length("employee_profiles"."full_name"), 0) <= 100 and coalesce(length("employee_profiles"."email"), 0) <= 254);