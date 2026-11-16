ALTER TYPE "public"."file_kind" ADD VALUE 'meeting_photo';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_meeting_created_idx" ON "files" USING btree ("meeting_id","created_at");