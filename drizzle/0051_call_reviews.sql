ALTER TYPE "public"."notification_type" ADD VALUE 'lead_reviewed';--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD COLUMN "recording_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD CONSTRAINT "lead_reviews_recording_id_files_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD CONSTRAINT "lead_reviews_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_reviews_agent_created_idx" ON "lead_reviews" USING btree ("agent_id","created_at");--> statement-breakpoint
ALTER TABLE "lead_reviews" ADD CONSTRAINT "lead_reviews_rating" CHECK ("lead_reviews"."rating" is null or "lead_reviews"."rating" between 1 and 5);