CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn', 'cancel_requested', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'medical');--> statement-breakpoint
CREATE TABLE "leave_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"step" integer,
	"approved" boolean NOT NULL,
	"actor_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"approval_path" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_dates" CHECK ("leave_requests"."start_date" <= "leave_requests"."end_date" and extract(year from "leave_requests"."start_date") = extract(year from "leave_requests"."end_date")),
	CONSTRAINT "leave_requests_days" CHECK ("leave_requests"."days" = ("leave_requests"."end_date" - "leave_requests"."start_date") + 1),
	CONSTRAINT "leave_requests_path" CHECK ("leave_requests"."approval_path" in ('senior', 'staff')),
	CONSTRAINT "leave_requests_reason_length" CHECK (coalesce(length("leave_requests"."reason"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "roster_entries" ADD COLUMN "leave_request_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_decisions" ADD CONSTRAINT "leave_decisions_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_decisions" ADD CONSTRAINT "leave_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_decisions_request_idx" ON "leave_decisions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "leave_requests_user_start_idx" ON "leave_requests" USING btree ("user_id","start_date");--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;