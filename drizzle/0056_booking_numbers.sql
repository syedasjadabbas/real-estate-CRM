CREATE SEQUENCE "public"."booking_ref_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "ref_no" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_ref_no_uq" ON "bookings" USING btree ("ref_no");--> statement-breakpoint
-- Number existing bookings in the order they were made, then continue the sequence after them (18 Nov 2026).
UPDATE "bookings" AS b SET "ref_no" = s.n FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "bookings") AS s WHERE b."id" = s."id";--> statement-breakpoint
SELECT setval('booking_ref_no_seq', COALESCE((SELECT max("ref_no") FROM "bookings"), 0) + 1, false);
