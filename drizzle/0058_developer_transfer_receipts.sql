CREATE TABLE "developer_transfer_receipts" (
	"transfer_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	CONSTRAINT "developer_transfer_receipts_payment_id_pk" PRIMARY KEY("payment_id")
);
--> statement-breakpoint
ALTER TABLE "booking_payments" DROP CONSTRAINT "booking_payments_kind_fields";--> statement-breakpoint
ALTER TABLE "booking_payments" DROP CONSTRAINT "booking_payments_developer_transfer_id_developer_transfers_id_fk";
--> statement-breakpoint
DROP INDEX "booking_payments_transfer_idx";--> statement-breakpoint
ALTER TABLE "developer_transfer_receipts" ADD CONSTRAINT "developer_transfer_receipts_transfer_id_developer_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."developer_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_transfer_receipts" ADD CONSTRAINT "developer_transfer_receipts_payment_id_booking_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."booking_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "developer_transfer_receipts_transfer_idx" ON "developer_transfer_receipts" USING btree ("transfer_id");--> statement-breakpoint
ALTER TABLE "booking_payments" DROP COLUMN "developer_transfer_id";--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_kind_fields" CHECK (("booking_payments"."kind" = 'payment' and "booking_payments"."receipt_no" is not null and "booking_payments"."method_id" is not null and "booking_payments"."reversal_of_id" is null and "booking_payments"."reversal_ref" is null and "booking_payments"."refund_ref" is null)
       or ("booking_payments"."kind" = 'reversal' and "booking_payments"."reversal_ref" is not null and "booking_payments"."reversal_of_id" is not null and "booking_payments"."note" is not null and "booking_payments"."receipt_no" is null and "booking_payments"."refund_ref" is null)
       or ("booking_payments"."kind"::text = 'refund' and "booking_payments"."refund_ref" is not null and "booking_payments"."method_id" is not null and "booking_payments"."receipt_no" is null and "booking_payments"."reversal_of_id" is null and "booking_payments"."reversal_ref" is null));