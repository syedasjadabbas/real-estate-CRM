ALTER TABLE "task_installment_rows" ADD COLUMN "due_on" date;--> statement-breakpoint
-- Questionnaire (2 Nov 2026) defaults. Each statement leaves values someone already chose untouched.
-- Q41: manager discount cap 5%.
INSERT INTO "app_settings" ("key", "value") VALUES ('proposal.manager_discount_cap_pct', '5') ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Q42: default down payment 25% (replaces the seeded 30% only if nobody has changed it).
UPDATE "app_settings" SET "value" = '25', "updated_at" = now() WHERE "key" = 'proposal.down_payment_pct' AND "value" = '30' AND "updated_by_id" IS NULL;--> statement-breakpoint
-- Q33: "Pay order" payment method.
INSERT INTO "payment_methods" ("name", "sort_order") VALUES ('Pay order', 4) ON CONFLICT ("name") DO NOTHING;
