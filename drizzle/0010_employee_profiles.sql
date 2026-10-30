CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"designation" text,
	"department" text,
	"phone_country_code" text,
	"phone_number" text,
	"phone_e164" text,
	"joining_date" date,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_phone_complete" CHECK (("employee_profiles"."phone_e164" is null) = ("employee_profiles"."phone_country_code" is null) and ("employee_profiles"."phone_e164" is null) = ("employee_profiles"."phone_number" is null)),
	CONSTRAINT "employee_profiles_phone_e164_format" CHECK ("employee_profiles"."phone_e164" is null or "employee_profiles"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "employee_profiles_text_lengths" CHECK (coalesce(length("employee_profiles"."designation"), 0) <= 100 and coalesce(length("employee_profiles"."department"), 0) <= 100)
);
--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_profiles_user_uq" ON "employee_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_profiles_department_idx" ON "employee_profiles" USING btree (lower("department"));