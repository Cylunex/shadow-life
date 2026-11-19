ALTER TABLE meals ADD COLUMN membership_updated_at timestamptz;

CREATE FUNCTION track_meal_membership_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.membership_updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE TRIGGER meal_membership_update BEFORE UPDATE OF occurred_on, state ON meals
  FOR EACH ROW WHEN (OLD.occurred_on IS DISTINCT FROM NEW.occurred_on OR OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION track_meal_membership_update();
