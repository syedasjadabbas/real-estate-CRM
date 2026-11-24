-- The audit log and record histories are append-only (client, 24 Nov 2026), like payments (0005): no edits, no deletes.
-- The one change allowed is the foreign key clearing the actor when a user row is removed.
CREATE FUNCTION "history_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only: history cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "history_append_only"();--> statement-breakpoint
CREATE TRIGGER "lead_activities_append_only" BEFORE UPDATE OR DELETE ON "lead_activities" FOR EACH ROW EXECUTE FUNCTION "history_append_only"();--> statement-breakpoint
CREATE TRIGGER "client_activities_append_only" BEFORE UPDATE OR DELETE ON "client_activities" FOR EACH ROW EXECUTE FUNCTION "history_append_only"();--> statement-breakpoint
CREATE TRIGGER "meeting_history_append_only" BEFORE UPDATE OR DELETE ON "meeting_history" FOR EACH ROW EXECUTE FUNCTION "history_append_only"();--> statement-breakpoint
CREATE TRIGGER "booking_stage_history_append_only" BEFORE UPDATE OR DELETE ON "booking_stage_history" FOR EACH ROW EXECUTE FUNCTION "history_append_only"();
