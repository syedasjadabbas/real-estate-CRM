-- A client is the person; every lead is one of their inquiries (owner's rule, 13 Nov 2026).
-- Gives every existing lead a client: it joins the client holding one of its numbers, otherwise one
-- client is created per phone number from that number's earliest lead. Lead details don't change.

-- 1. Leads whose number (primary or extra) a client already holds join that client.
UPDATE "leads" l SET "client_id" = c."id"
FROM "clients" c
WHERE l."client_id" IS NULL AND l."deleted_at" IS NULL
  AND (
    c."phone_e164" = l."phone_e164"
    OR EXISTS (SELECT 1 FROM "client_phones" cp WHERE cp."client_id" = c."id" AND cp."e164" = l."phone_e164")
    OR EXISTS (
      SELECT 1 FROM "lead_phones" lp
      WHERE lp."lead_id" = l."id"
        AND (lp."e164" = c."phone_e164" OR EXISTS (SELECT 1 FROM "client_phones" cp2 WHERE cp2."client_id" = c."id" AND cp2."e164" = lp."e164"))
    )
  );
--> statement-breakpoint
-- 2. One client per remaining number, from its earliest lead (that lead's agent is the original agent).
INSERT INTO "clients" ("name", "phone_country_code", "phone_number", "phone_e164", "email", "city_id", "city_other", "owner_id", "created_by_id", "created_at", "updated_at", "last_activity_at")
SELECT DISTINCT ON (l."phone_e164")
  l."name", l."phone_country_code", l."phone_number", l."phone_e164", l."email", l."city_id", l."city_other",
  l."owner_id", l."created_by_id", l."created_at", now(), l."last_activity_at"
FROM "leads" l
WHERE l."client_id" IS NULL AND l."deleted_at" IS NULL
ORDER BY l."phone_e164", l."created_at", l."id";
--> statement-breakpoint
-- 3. Link those leads to their new client.
UPDATE "leads" l SET "client_id" = c."id"
FROM "clients" c
WHERE l."client_id" IS NULL AND l."deleted_at" IS NULL AND c."phone_e164" = l."phone_e164";
--> statement-breakpoint
-- 4. Each new client's history starts with a "created" entry.
INSERT INTO "client_activities" ("client_id", "type", "data", "created_at")
SELECT c."id", 'created', jsonb_build_object('mode', 'backfill'), c."created_at"
FROM "clients" c
WHERE NOT EXISTS (SELECT 1 FROM "client_activities" a WHERE a."client_id" = c."id");
--> statement-breakpoint
-- 5. Open bookings belong to the lead's client (F-13), as when a lead is converted.
UPDATE "bookings" b SET "client_id" = l."client_id"
FROM "leads" l
WHERE b."lead_id" = l."id" AND b."client_id" IS NULL AND b."stage" <> 'cancelled' AND l."client_id" IS NOT NULL;
