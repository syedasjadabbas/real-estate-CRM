ALTER TABLE "leave_requests" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "employee_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "recorded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_profile_id_employee_profiles_id_fk" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."employee_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_profile_start_idx" ON "leave_requests" USING btree ("employee_profile_id","start_date");--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_one_person" CHECK (("leave_requests"."user_id" is null) <> ("leave_requests"."employee_profile_id" is null));