ALTER TABLE "projects" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_name_lower_uq" ON "projects" USING btree (lower("name"));