CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'meeting';--> statement-breakpoint
CREATE TABLE "meeting_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"organizer_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"notes" text,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_title_not_blank" CHECK (length(btrim("meetings"."title")) > 0),
	CONSTRAINT "meetings_ends_after_start" CHECK ("meetings"."ends_at" is null or "meetings"."ends_at" > "meetings"."starts_at"),
	CONSTRAINT "meetings_completed_fields" CHECK (("meetings"."status" = 'completed') = ("meetings"."completed_at" is not null)),
	CONSTRAINT "meetings_cancelled_fields" CHECK (("meetings"."status" = 'cancelled') = ("meetings"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "meeting_history" ADD CONSTRAINT "meeting_history_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_history" ADD CONSTRAINT "meeting_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_history_meeting_created_idx" ON "meeting_history" USING btree ("meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_organizer_status_starts_idx" ON "meetings" USING btree ("organizer_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_lead_idx" ON "meetings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "meetings_created_by_idx" ON "meetings" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "meetings_updated_idx" ON "meetings" USING btree ("updated_at");