-- A booking counts as contact (client, 24 Nov 2026): fill it in for the bookings already made; never moves a date back.
UPDATE "leads" l SET "last_contact_at" = b.at
FROM (SELECT lead_id, max(created_at) AS at FROM bookings GROUP BY lead_id) b
WHERE b.lead_id = l.id AND (l.last_contact_at IS NULL OR l.last_contact_at < b.at);
