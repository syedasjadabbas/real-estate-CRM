CREATE TYPE "public"."roster_status" AS ENUM('in_office', 'on_site', 'on_leave', 'leads_off');--> statement-breakpoint
CREATE TYPE "public"."target_period" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "daily_report_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_report_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"meetings" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"bookings" integer DEFAULT 0 NOT NULL,
	"remarks" text,
	CONSTRAINT "daily_report_lines_non_negative" CHECK ("daily_report_lines"."leads" >= 0 and "daily_report_lines"."calls" >= 0 and "daily_report_lines"."meetings" >= 0 and "daily_report_lines"."tokens" >= 0 and "daily_report_lines"."bookings" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"submitted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "roster_status" NOT NULL,
	"set_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" "target_period" NOT NULL,
	"period_start" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"meetings" integer DEFAULT 0 NOT NULL,
	"sold_sqft" numeric(12, 2) DEFAULT 0 NOT NULL,
	"set_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_values_non_negative" CHECK ("targets"."calls" >= 0 and "targets"."meetings" >= 0 and "targets"."sold_sqft" >= 0),
	CONSTRAINT "targets_weekly_monday" CHECK ("targets"."period" <> 'weekly' or extract(isodow from "targets"."period_start") = 1),
	CONSTRAINT "targets_monthly_first" CHECK ("targets"."period" <> 'monthly' or extract(day from "targets"."period_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD CONSTRAINT "daily_report_lines_daily_report_id_daily_reports_id_fk" FOREIGN KEY ("daily_report_id") REFERENCES "public"."daily_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD CONSTRAINT "daily_report_lines_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_report_lines_report_agent_uq" ON "daily_report_lines" USING btree ("daily_report_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_team_date_uq" ON "daily_reports" USING btree ("team_id","report_date");--> statement-breakpoint
CREATE INDEX "daily_reports_date_idx" ON "daily_reports" USING btree ("report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_entries_user_date_uq" ON "roster_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "roster_entries_team_date_idx" ON "roster_entries" USING btree ("team_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_user_period_start_uq" ON "targets" USING btree ("user_id","period","period_start");--> statement-breakpoint
CREATE INDEX "targets_period_start_idx" ON "targets" USING btree ("period","period_start");