ALTER TABLE "clients" ADD COLUMN "city_other" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "city_other" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_name_lower_uq" ON "cities" USING btree (lower("name"));