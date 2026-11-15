CREATE TABLE "employee_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_notes_body" CHECK (length(btrim("employee_notes"."body")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "employee_notes" ADD CONSTRAINT "employee_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_notes" ADD CONSTRAINT "employee_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_notes_user_created_idx" ON "employee_notes" USING btree ("user_id","created_at");