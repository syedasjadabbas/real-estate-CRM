-- Owner's decision (13 Nov 2026): Manager and Admin are one role, Admin. Every Sales Manager becomes
-- an Admin with full Admin access. The "manager" enum value stays (Postgres can't drop it in place)
-- but is no longer granted. Teams they lead keep them as team manager.
UPDATE "users" SET "role" = 'admin', "updated_at" = now() WHERE "role" = 'manager';
