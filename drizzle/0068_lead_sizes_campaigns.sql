ALTER TABLE "leads" ADD COLUMN "size_sqft" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "property_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "marla_sqft" numeric(8, 2) DEFAULT 225 NOT NULL;--> statement-breakpoint
-- Sizes already given in square feet; other words are read when the lead is next saved.
UPDATE "leads" SET "size_sqft" = replace(substring("desired_size" from '^\s*([0-9][0-9,]*(?:\.[0-9]+)?)'), ',', '')::numeric WHERE "desired_size" ~* '^\s*[0-9][0-9,]*(\.[0-9]+)?\s*sq\.?\s*ft\s*$';
