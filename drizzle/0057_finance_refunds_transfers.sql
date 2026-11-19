ALTER TYPE "public"."booking_payment_kind" ADD VALUE 'refund';--> statement-breakpoint
CREATE SEQUENCE "public"."booking_payment_refund_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "developer_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transferred_on" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developer_transfers_amount_positive" CHECK ("developer_transfers"."amount" > 0),
	CONSTRAINT "developer_transfers_text" CHECK (coalesce(length("developer_transfers"."reference"), 0) <= 120 and coalesce(length("developer_transfers"."note"), 0) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "booking_payments" DROP CONSTRAINT "booking_payments_kind_fields";--> statement-breakpoint
ALTER TABLE "booking_payments" ADD COLUMN "refund_ref" integer;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD COLUMN "developer_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "refund_deduction" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "refund_due" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "developer_transfers" ADD CONSTRAINT "developer_transfers_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "developer_transfers_date_idx" ON "developer_transfers" USING btree ("transferred_on");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_developer_transfer_id_developer_transfers_id_fk" FOREIGN KEY ("developer_transfer_id") REFERENCES "public"."developer_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_refund_ref_uq" ON "booking_payments" USING btree ("refund_ref");--> statement-breakpoint
CREATE INDEX "booking_payments_transfer_idx" ON "booking_payments" USING btree ("developer_transfer_id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_kind_fields" CHECK (("booking_payments"."kind" = 'payment' and "booking_payments"."receipt_no" is not null and "booking_payments"."method_id" is not null and "booking_payments"."reversal_of_id" is null and "booking_payments"."reversal_ref" is null and "booking_payments"."refund_ref" is null)
       or ("booking_payments"."kind" = 'reversal' and "booking_payments"."reversal_ref" is not null and "booking_payments"."reversal_of_id" is not null and "booking_payments"."note" is not null and "booking_payments"."receipt_no" is null and "booking_payments"."refund_ref" is null)
       or ("booking_payments"."kind"::text = 'refund' and "booking_payments"."refund_ref" is not null and "booking_payments"."method_id" is not null and "booking_payments"."receipt_no" is null and "booking_payments"."reversal_of_id" is null and "booking_payments"."reversal_ref" is null and "booking_payments"."developer_transfer_id" is null));--> statement-breakpoint
-- The client's income and expense categories (Client Inputs, 10 Nov 2026), added once; an existing one with the same name is left alone.
INSERT INTO "finance_categories" ("kind", "name", "sort_order") VALUES
  ('income', 'Commission', 10),
  ('income', 'Marketing / service fees', 20),
  ('income', 'Other income', 90),
  ('expense', 'Advertising (Meta, Google)', 10),
  ('expense', 'Influencers', 20),
  ('expense', 'Content production (video, photography, drone)', 30),
  ('expense', 'Events', 40),
  ('expense', 'Salaries', 50),
  ('expense', 'Agent commissions', 60),
  ('expense', 'Rent and utilities', 70),
  ('expense', 'Internet and SIM / telecom', 80),
  ('expense', 'Transport and site visits', 90),
  ('expense', 'Software and hosting', 100),
  ('expense', 'Printing and brochures', 110),
  ('expense', 'Miscellaneous', 120)
ON CONFLICT DO NOTHING;
