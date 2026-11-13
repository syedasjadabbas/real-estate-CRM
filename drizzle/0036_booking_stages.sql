ALTER TABLE "bookings" ALTER COLUMN "stage" SET DEFAULT 'token_pending';--> statement-breakpoint
-- Owner's decision (14 Nov 2026): bookings use Token, Partial Down Payment, Complete Down Payment and
-- Closed Won. Open bookings in the retired in-between stages move to Token (stored as token_pending);
-- down_payment and agreement_pending keep their rows and now read Partial / Complete Down Payment.
UPDATE "bookings" SET "stage" = 'token_pending', "updated_at" = now()
WHERE "stage" IN ('negotiation', 'token_received', 'provisional_receipt', 'sales_order', 'booking_form');
