-- A booking is not customer contact (client, 24 Nov 2026), so this undoes 0064. Only leads with a booking were
-- touched by it: their date is worked out again from real interactions, or cleared when there are none.
UPDATE "leads" l SET "last_contact_at" = (
  SELECT max(x.at) FROM (
    SELECT created_at AS at FROM files WHERE lead_id = l.id AND kind::text IN ('call_recording', 'whatsapp_call', 'whatsapp_chat') AND deleted_at IS NULL
    UNION ALL
    SELECT created_at FROM lead_activities WHERE lead_id = l.id AND type::text = 'note' AND body LIKE 'Call · Talked%'
    UNION ALL
    SELECT least(starts_at, coalesce(completed_at, starts_at)) FROM meetings WHERE lead_id = l.id AND status::text = 'completed'
  ) x
)
WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.lead_id = l.id);
