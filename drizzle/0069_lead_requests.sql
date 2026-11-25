ALTER TYPE "public"."lead_activity_type" ADD VALUE 'request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_request' BEFORE 'meeting_missed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_request_decided' BEFORE 'meeting_missed';--> statement-breakpoint
CREATE TABLE "lead_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_requests_type" CHECK ("lead_requests"."type" in ('name_change', 'wrong_number', 'booked'))
);
--> statement-breakpoint
CREATE TABLE "meeting_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_reviews_rating" CHECK ("meeting_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "lead_enquiries" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "wrong_number_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reviews" ADD CONSTRAINT "meeting_reviews_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reviews" ADD CONSTRAINT "meeting_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_requests_one_pending_uq" ON "lead_requests" USING btree ("lead_id","type") WHERE "lead_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "lead_requests_status_idx" ON "lead_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "meeting_reviews_meeting_idx" ON "meeting_reviews" USING btree ("meeting_id","created_at");