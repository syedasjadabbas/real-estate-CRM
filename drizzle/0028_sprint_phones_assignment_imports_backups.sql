CREATE TYPE "public"."backup_run_kind" AS ENUM('backup', 'restore', 'restore_check', 'prune');--> statement-breakpoint
CREATE TYPE "public"."backup_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('valid', 'duplicate', 'invalid', 'created', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."lead_assignment_mode" AS ENUM('scored', 'returning_customer', 'claim', 'manual', 'creator', 'import');--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "backup_run_kind" NOT NULL,
	"status" "backup_run_status" DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"location" text,
	"size_bytes" integer,
	"message" text,
	"actor_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"country_code" text NOT NULL,
	"number" text NOT NULL,
	"e164" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_phones_position_range" CHECK ("client_phones"."position" between 2 and 5),
	CONSTRAINT "client_phones_e164_format" CHECK ("client_phones"."e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"assignee_id" uuid,
	"previous_owner_id" uuid,
	"mode" "lead_assignment_mode" NOT NULL,
	"reason" text NOT NULL,
	"breakdown" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_name" text,
	"uploaded_by_id" uuid NOT NULL,
	"status" "import_batch_status" DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"created_leads" integer DEFAULT 0 NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"data" jsonb NOT NULL,
	"phone_e164" text,
	"status" "import_row_status" NOT NULL,
	"errors" jsonb,
	"match_lead_id" uuid,
	"lead_id" uuid
);
--> statement-breakpoint
CREATE TABLE "lead_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"country_code" text NOT NULL,
	"number" text NOT NULL,
	"e164" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_phones_position_range" CHECK ("lead_phones"."position" between 2 and 5),
	CONSTRAINT "lead_phones_e164_format" CHECK ("lead_phones"."e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phones" ADD CONSTRAINT "client_phones_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_previous_owner_id_users_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_batches" ADD CONSTRAINT "lead_import_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_batches" ADD CONSTRAINT "lead_import_batches_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_batches" ADD CONSTRAINT "lead_import_batches_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_batch_id_lead_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."lead_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_match_lead_id_leads_id_fk" FOREIGN KEY ("match_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_rows" ADD CONSTRAINT "lead_import_rows_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_phones" ADD CONSTRAINT "lead_phones_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_phones_client_position_uq" ON "client_phones" USING btree ("client_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "client_phones_client_e164_uq" ON "client_phones" USING btree ("client_id","e164");--> statement-breakpoint
CREATE INDEX "client_phones_e164_idx" ON "client_phones" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "lead_assignments_lead_idx" ON "lead_assignments" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_assignments_assignee_idx" ON "lead_assignments" USING btree ("assignee_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_import_batches_status_idx" ON "lead_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lead_import_batches_uploader_idx" ON "lead_import_batches" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_import_rows_batch_row_uq" ON "lead_import_rows" USING btree ("batch_id","row_no");--> statement-breakpoint
CREATE INDEX "lead_import_rows_e164_idx" ON "lead_import_rows" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_phones_lead_position_uq" ON "lead_phones" USING btree ("lead_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_phones_lead_e164_uq" ON "lead_phones" USING btree ("lead_id","e164");--> statement-breakpoint
CREATE INDEX "lead_phones_e164_idx" ON "lead_phones" USING btree ("e164");