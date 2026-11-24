ALTER TABLE "leads" ADD COLUMN "last_contact_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill from what was already recorded: call recordings, WhatsApp screenshots, calls marked Talked, completed meetings.
UPDATE "leads" l SET "last_contact_at" = c.at FROM (
  SELECT lead_id, max(at) AS at FROM (
    SELECT lead_id, created_at AS at FROM files WHERE kind::text IN ('call_recording', 'whatsapp_call', 'whatsapp_chat') AND deleted_at IS NULL AND lead_id IS NOT NULL
    UNION ALL
    SELECT lead_id, created_at FROM lead_activities WHERE type::text = 'note' AND body LIKE 'Call · Talked%'
    UNION ALL
    SELECT lead_id, least(starts_at, coalesce(completed_at, starts_at)) FROM meetings WHERE status::text = 'completed'
  ) x GROUP BY lead_id
) c WHERE c.lead_id = l.id;
