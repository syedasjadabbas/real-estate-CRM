CREATE TYPE "public"."unit_sale_model" AS ENUM('whole', 'spu', 'fractional_50');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('available', 'partially_booked', 'reserved', 'booked', 'sold');--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_no" text NOT NULL,
	"floor" text,
	"block" text,
	"sale_model" "unit_sale_model" DEFAULT 'whole' NOT NULL,
	"area_sqft" numeric(12, 2) NOT NULL,
	"base_price" numeric(15, 2) NOT NULL,
	"nature" text,
	"category" text,
	"type" text,
	"bedrooms" integer,
	"premium" text,
	"status" "unit_status" DEFAULT 'available' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"listed_on" date,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_area_positive" CHECK ("units"."area_sqft" > 0),
	CONSTRAINT "units_price_non_negative" CHECK ("units"."base_price" >= 0),
	CONSTRAINT "units_bedrooms_non_negative" CHECK ("units"."bedrooms" is null or "units"."bedrooms" >= 0),
	CONSTRAINT "units_partial_needs_split" CHECK ("units"."status" <> 'partially_booked' or "units"."sale_model" <> 'whole')
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dimension_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "units_project_unit_no_uq" ON "units" USING btree ("project_id",lower("unit_no"));--> statement-breakpoint
CREATE INDEX "units_project_status_idx" ON "units" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "units_project_floor_idx" ON "units" USING btree ("project_id","floor");