CREATE TABLE "target_custom_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" numeric(14, 2) NOT NULL,
	"achieved" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_custom_goals_values" CHECK ("target_custom_goals"."goal" > 0 and "target_custom_goals"."achieved" >= 0),
	CONSTRAINT "target_custom_goals_name" CHECK (length(btrim("target_custom_goals"."name")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "target_custom_goals" ADD CONSTRAINT "target_custom_goals_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_custom_goals" ADD CONSTRAINT "target_custom_goals_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "target_custom_goals_target_idx" ON "target_custom_goals" USING btree ("target_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "target_custom_goals_name_uq" ON "target_custom_goals" USING btree ("target_id",lower("name"));