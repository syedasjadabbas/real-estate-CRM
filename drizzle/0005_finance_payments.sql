CREATE TYPE "public"."booking_payment_kind" AS ENUM('payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."booking_payment_type" AS ENUM('token', 'down_payment', 'installment', 'other');--> statement-breakpoint
CREATE TYPE "public"."reversal_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE SEQUENCE "public"."booking_payment_receipt_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."booking_payment_reversal_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "booking_payment_kind" NOT NULL,
	"type" "booking_payment_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"received_on" date NOT NULL,
	"method_id" uuid,
	"reference" text,
	"note" text,
	"receipt_no" integer,
	"reversal_ref" integer,
	"reversal_of_id" uuid,
	"reversal_request_id" uuid,
	"idempotency_key" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payments_amount_positive" CHECK ("booking_payments"."amount" > 0),
	CONSTRAINT "booking_payments_kind_fields" CHECK (("booking_payments"."kind" = 'payment' and "booking_payments"."receipt_no" is not null and "booking_payments"."method_id" is not null and "booking_payments"."reversal_of_id" is null and "booking_payments"."reversal_ref" is null)
       or ("booking_payments"."kind" = 'reversal' and "booking_payments"."reversal_ref" is not null and "booking_payments"."reversal_of_id" is not null and "booking_payments"."note" is not null and "booking_payments"."receipt_no" is null))
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_methods_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payment_reversal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "reversal_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversal_decided_fields" CHECK (("payment_reversal_requests"."status" = 'pending') = ("payment_reversal_requests"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_reversal_of_id_booking_payments_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."booking_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_reversal_request_id_payment_reversal_requests_id_fk" FOREIGN KEY ("reversal_request_id") REFERENCES "public"."payment_reversal_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal_requests" ADD CONSTRAINT "payment_reversal_requests_payment_id_booking_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."booking_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal_requests" ADD CONSTRAINT "payment_reversal_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversal_requests" ADD CONSTRAINT "payment_reversal_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_receipt_no_uq" ON "booking_payments" USING btree ("receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_reversal_ref_uq" ON "booking_payments" USING btree ("reversal_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_one_reversal_uq" ON "booking_payments" USING btree ("reversal_of_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_idempotency_uq" ON "booking_payments" USING btree ("recorded_by_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "booking_payments_booking_idx" ON "booking_payments" USING btree ("booking_id","received_on");--> statement-breakpoint
CREATE INDEX "booking_payments_received_idx" ON "booking_payments" USING btree ("received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reversal_one_pending_uq" ON "payment_reversal_requests" USING btree ("payment_id") WHERE "payment_reversal_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_reversal_status_idx" ON "payment_reversal_requests" USING btree ("status","created_at");--> statement-breakpoint
-- Financial records are append-only (FR-206): no UPDATE or DELETE on booking_payments, ever.
CREATE FUNCTION "booking_payments_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_payments rows are immutable; record a reversal instead' USING ERRCODE = 'P0001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "booking_payments_no_update_delete" BEFORE UPDATE OR DELETE ON "booking_payments"
  FOR EACH ROW EXECUTE FUNCTION "booking_payments_append_only"();--> statement-breakpoint
-- A reversal must mirror an existing, un-reversed payment of the same booking, approved via a request.
CREATE FUNCTION "booking_payments_check_reversal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original record; req record;
BEGIN
  IF NEW.kind = 'reversal' THEN
    SELECT * INTO original FROM booking_payments WHERE id = NEW.reversal_of_id;
    IF original IS NULL OR original.kind <> 'payment' THEN
      RAISE EXCEPTION 'a reversal must reference a payment' USING ERRCODE = 'P0001';
    END IF;
    IF original.booking_id <> NEW.booking_id OR original.amount <> NEW.amount OR original.type <> NEW.type THEN
      RAISE EXCEPTION 'a reversal must match the original booking, amount and type' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO req FROM payment_reversal_requests WHERE id = NEW.reversal_request_id;
    IF req IS NULL OR req.payment_id <> NEW.reversal_of_id OR req.status <> 'approved' THEN
      RAISE EXCEPTION 'a reversal needs an approved reversal request for that payment' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "booking_payments_reversal_check" BEFORE INSERT ON "booking_payments"
  FOR EACH ROW EXECUTE FUNCTION "booking_payments_check_reversal"();--> statement-breakpoint
-- Reversal requests: decided once (pending → approved / rejected), never deleted or re-opened.
CREATE FUNCTION "payment_reversal_requests_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reversal requests cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'pending' OR NEW.payment_id <> OLD.payment_id OR NEW.reason <> OLD.reason
     OR NEW.requested_by_id <> OLD.requested_by_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a decided reversal request cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payment_reversal_requests_guard" BEFORE UPDATE OR DELETE ON "payment_reversal_requests"
  FOR EACH ROW EXECUTE FUNCTION "payment_reversal_requests_guard"();--> statement-breakpoint
-- Proposed default payment methods (Q-F7, configurable; client to confirm).
INSERT INTO "payment_methods" ("name", "sort_order") VALUES ('Cash', 0), ('Bank Transfer', 1), ('Cheque', 2), ('Online Payment', 3)
  ON CONFLICT ("name") DO NOTHING;
