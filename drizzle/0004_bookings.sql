CREATE TYPE "public"."booking_stage" AS ENUM('negotiation', 'token_pending', 'token_received', 'provisional_receipt', 'sales_order', 'booking_form', 'down_payment', 'agreement_pending', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_docs_status" AS ENUM('not_submitted', 'submitted', 'verified');--> statement-breakpoint
CREATE TABLE "booking_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_stage" "booking_stage",
	"to_stage" "booking_stage" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"client_id" uuid,
	"agent_id" uuid,
	"rate_per_sqft" numeric(14, 2) NOT NULL,
	"area_sqft" numeric(12, 2) NOT NULL,
	"total_sale" numeric(16, 2) NOT NULL,
	"token_amount" numeric(15, 2) NOT NULL,
	"reserved_until" date,
	"stage" "booking_stage" DEFAULT 'negotiation' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_instructions" text,
	"agreement_sent_on" date,
	"payment_docs_status" "payment_docs_status" DEFAULT 'not_submitted' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_rate_positive" CHECK ("bookings"."rate_per_sqft" > 0),
	CONSTRAINT "bookings_area_positive" CHECK ("bookings"."area_sqft" > 0),
	CONSTRAINT "bookings_token_positive" CHECK ("bookings"."token_amount" > 0),
	CONSTRAINT "bookings_token_within_total" CHECK ("bookings"."token_amount" <= "bookings"."total_sale"),
	CONSTRAINT "bookings_cancelled_fields" CHECK (("bookings"."stage" = 'cancelled') = ("bookings"."cancelled_at" is not null)),
	CONSTRAINT "bookings_cancel_reason" CHECK ("bookings"."stage" <> 'cancelled' or "bookings"."cancelled_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "booking_stage_history" ADD CONSTRAINT "booking_stage_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_stage_history" ADD CONSTRAINT "booking_stage_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_stage_history_booking_idx" ON "booking_stage_history" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_unit_uq" ON "bookings" USING btree ("unit_id") WHERE "bookings"."stage" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "bookings_project_stage_idx" ON "bookings" USING btree ("project_id","stage");--> statement-breakpoint
CREATE INDEX "bookings_agent_idx" ON "bookings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "bookings_lead_idx" ON "bookings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "bookings_client_idx" ON "bookings" USING btree ("client_id");