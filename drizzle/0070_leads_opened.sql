-- Opened (client, 25 Nov 2026): leads already worked on count as opened; New leads nobody has touched don't.
UPDATE "leads" SET "opened_at" = coalesce("first_touch_at", "stage_changed_at", "created_at") WHERE "opened_at" IS NULL AND ("stage" <> 'new_lead' OR "first_touch_at" IS NOT NULL);
