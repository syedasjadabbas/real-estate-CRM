-- F-20 (FR-052): contracts and documents kept on the client itself, because a booked lead is read-only
-- and a client added by hand has no lead. Additive: one nullable column; the owner check only widens.
-- No existing row is changed.
ALTER TYPE "public"."client_activity_type" ADD VALUE 'file_uploaded';--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_owner";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_client_created_idx" ON "files" USING btree ("client_id","created_at");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner" CHECK ("files"."lead_id" is not null or "files"."finance_entry_id" is not null or "files"."client_id" is not null);