-- First and last names stay in step with the full name on every write path (a title stays with the first name).
CREATE FUNCTION person_first_name(full_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(btrim(regexp_replace(full_name, '\s+', ' ', 'g')) from '(?i)^((?:mr|mrs|ms|miss|dr|engr|eng|prof|col|maj|gen|capt|brig)\.?\s+\S+|\S+)')
$$;
--> statement-breakpoint
CREATE FUNCTION sync_person_name() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  full_name text := btrim(regexp_replace(to_jsonb(NEW) ->> TG_ARGV[0], '\s+', ' ', 'g'));
BEGIN
  IF full_name IS NULL OR full_name = '' THEN
    NEW.first_name := NULL;
    NEW.last_name := NULL;
  ELSIF NEW.first_name IS NULL OR btrim(concat_ws(' ', NEW.first_name, NULLIF(NEW.last_name, ''))) IS DISTINCT FROM full_name THEN
    NEW.first_name := person_first_name(full_name);
    NEW.last_name := NULLIF(btrim(substr(full_name, length(NEW.first_name) + 1)), '');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER leads_person_name BEFORE INSERT OR UPDATE OF name, first_name, last_name ON leads FOR EACH ROW EXECUTE FUNCTION sync_person_name('name');
--> statement-breakpoint
CREATE TRIGGER clients_person_name BEFORE INSERT OR UPDATE OF name, first_name, last_name ON clients FOR EACH ROW EXECUTE FUNCTION sync_person_name('name');
--> statement-breakpoint
CREATE TRIGGER users_person_name BEFORE INSERT OR UPDATE OF name, first_name, last_name ON users FOR EACH ROW EXECUTE FUNCTION sync_person_name('name');
--> statement-breakpoint
CREATE TRIGGER employee_profiles_person_name BEFORE INSERT OR UPDATE OF full_name, first_name, last_name ON employee_profiles FOR EACH ROW EXECUTE FUNCTION sync_person_name('full_name');
--> statement-breakpoint
UPDATE leads SET name = name;
--> statement-breakpoint
UPDATE clients SET name = name;
--> statement-breakpoint
UPDATE users SET name = name;
--> statement-breakpoint
UPDATE employee_profiles SET full_name = full_name;
