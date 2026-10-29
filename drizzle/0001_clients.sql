CREATE TYPE "public"."client_activity_type" AS ENUM('created', 'note', 'update', 'follow_up_scheduled', 'follow_up_done', 'lead_linked', 'assignment');--> statement-breakpoint
CREATE TYPE "public"."client_relationship" AS ENUM('prospect', 'investor', 'repeat_investor');--> statement-breakpoint
CREATE TABLE "client_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "client_activity_type" NOT NULL,
	"body" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone_country_code" text NOT NULL,
	"phone_number" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"city_id" uuid,
	"relationship" "client_relationship",
	"owner_id" uuid,
	"next_follow_up_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_phone_e164_format" CHECK ("clients"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_follow_ups" ADD CONSTRAINT "client_follow_ups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_follow_ups" ADD CONSTRAINT "client_follow_ups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_follow_ups" ADD CONSTRAINT "client_follow_ups_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_follow_ups" ADD CONSTRAINT "client_follow_ups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_activities_client_created_idx" ON "client_activities" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "client_follow_ups_client_idx" ON "client_follow_ups" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_follow_ups_assignee_status_due_idx" ON "client_follow_ups" USING btree ("assignee_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_phone_e164_uq" ON "clients" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "clients_owner_idx" ON "clients" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "clients_updated_idx" ON "clients" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_client_idx" ON "leads" USING btree ("client_id");