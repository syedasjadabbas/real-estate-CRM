CREATE TYPE "public"."holiday_scope" AS ENUM('company', 'regional');--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"scope" "holiday_scope" DEFAULT 'company' NOT NULL,
	"region" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_name_not_blank" CHECK (length(btrim("holidays"."name")) > 0),
	CONSTRAINT "holidays_region_matches_scope" CHECK (("holidays"."scope" = 'regional') = ("holidays"."region" is not null and length(btrim("holidays"."region")) > 0))
);
--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_scope_region_uq" ON "holidays" USING btree ("date","scope",lower(coalesce("region", '')));--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("date");