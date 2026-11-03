-- F-1 (audit §17): while a lead has an open booking (any stage except confirmed / cancelled), its stage
-- follows the booking. The services check this after locking the lead row; this trigger is the backstop
-- for any other writer. Allowed while a booking is open: Booking in Process and Booked (confirm).
-- Additive: no existing row is changed; it only applies to future stage updates.
CREATE FUNCTION "leads_stage_follows_open_booking"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage
     AND NEW.stage NOT IN ('booking_in_process', 'booked')
     AND EXISTS (SELECT 1 FROM bookings b WHERE b.lead_id = NEW.id AND b.stage NOT IN ('confirmed', 'cancelled')) THEN
    RAISE EXCEPTION 'lead % has an open booking; its stage follows the booking', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "leads_stage_follows_open_booking" BEFORE UPDATE OF "stage" ON "leads"
  FOR EACH ROW EXECUTE FUNCTION "leads_stage_follows_open_booking"();
