CREATE TYPE "public"."finance_entry_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "finance_entry_kind" NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_categories_name" CHECK (length(btrim("finance_categories"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "finance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "finance_entry_kind" NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"entry_date" date NOT NULL,
	"method_id" uuid,
	"reference" text,
	"payee" text,
	"note" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_entries_amount_positive" CHECK ("finance_entries"."amount" > 0),
	CONSTRAINT "finance_entries_payee_expense_only" CHECK ("finance_entries"."payee" is null or "finance_entries"."kind" = 'expense'),
	CONSTRAINT "finance_entries_void_reason" CHECK (("finance_entries"."voided_at" is null) = ("finance_entries"."void_reason" is null)),
	CONSTRAINT "finance_entries_text_lengths" CHECK (coalesce(length("finance_entries"."reference"), 0) <= 120 and coalesce(length("finance_entries"."payee"), 0) <= 120 and coalesce(length("finance_entries"."note"), 0) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "finance_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_kind_name_uq" ON "finance_categories" USING btree ("kind",lower("name"));--> statement-breakpoint
CREATE INDEX "finance_entries_kind_date_idx" ON "finance_entries" USING btree ("kind","entry_date");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_finance_entry_id_finance_entries_id_fk" FOREIGN KEY ("finance_entry_id") REFERENCES "public"."finance_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner" CHECK ("files"."lead_id" is not null or "files"."finance_entry_id" is not null);