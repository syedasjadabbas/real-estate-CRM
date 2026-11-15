CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone,
	"corrected_by_id" uuid,
	"correction_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_out_after_in" CHECK ("attendance_records"."check_out_at" is null or "attendance_records"."check_out_at" >= "attendance_records"."check_in_at"),
	CONSTRAINT "attendance_records_note_length" CHECK (coalesce(length("attendance_records"."correction_note"), 0) <= 300)
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_corrected_by_id_users_id_fk" FOREIGN KEY ("corrected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_user_date_uq" ON "attendance_records" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_date_idx" ON "attendance_records" USING btree ("date");