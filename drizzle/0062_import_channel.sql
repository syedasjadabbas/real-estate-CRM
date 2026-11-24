-- Leads created from an import batch were marked manual; give them their real channel.
UPDATE "leads" SET "inbound_channel" = 'import' WHERE "inbound_channel" = 'manual' AND "id" IN (SELECT "lead_id" FROM "lead_import_rows" WHERE "lead_id" IS NOT NULL AND "status" = 'created');
