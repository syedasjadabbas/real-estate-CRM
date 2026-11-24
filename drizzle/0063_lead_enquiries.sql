CREATE TABLE "lead_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"is_repeat" boolean NOT NULL,
	"enquired_at" timestamp with time zone NOT NULL,
	"source_id" uuid,
	"channel_other" text,
	"agent_id" uuid,
	"recorded_by_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_enquiries_one_channel" CHECK ("lead_enquiries"."source_id" is null or "lead_enquiries"."channel_other" is null),
	CONSTRAINT "lead_enquiries_channel_other" CHECK ("lead_enquiries"."channel_other" is null or length(btrim("lead_enquiries"."channel_other")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "lead_enquiries" ADD CONSTRAINT "lead_enquiries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_enquiries" ADD CONSTRAINT "lead_enquiries_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_enquiries" ADD CONSTRAINT "lead_enquiries_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_enquiries" ADD CONSTRAINT "lead_enquiries_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_enquiries_lead_idx" ON "lead_enquiries" USING btree ("lead_id","enquired_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_enquiries_first_uq" ON "lead_enquiries" USING btree ("lead_id") WHERE not "lead_enquiries"."is_repeat";
--> statement-breakpoint
-- History so far: each lead's first enquiry, and the repeats on its timeline (their channel wasn't recorded).
INSERT INTO "lead_enquiries" ("lead_id", "is_repeat", "enquired_at", "source_id", "agent_id", "recorded_by_id", "created_at")
SELECT "id", false, "created_at", "source_id", "owner_id", "created_by_id", "created_at" FROM "leads";
--> statement-breakpoint
INSERT INTO "lead_enquiries" ("lead_id", "is_repeat", "enquired_at", "agent_id", "recorded_by_id", "note", "created_at")
SELECT a."lead_id", true, a."created_at", l."owner_id", a."actor_id", a."body", a."created_at" FROM "lead_activities" a JOIN "leads" l ON l."id" = a."lead_id" WHERE a."type"::text = 'regenerated';
