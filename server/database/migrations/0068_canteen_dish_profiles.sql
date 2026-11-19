ALTER TABLE merchant_foods ADD COLUMN stall text;
ALTER TABLE merchant_foods ADD COLUMN profile jsonb CHECK (profile IS NULL OR jsonb_typeof(profile)='object');
DROP INDEX merchant_food_identity;
CREATE UNIQUE INDEX merchant_food_identity ON merchant_foods(subject_id,lower(merchant),lower(dish),coalesce(lower(stall),''));

ALTER TABLE intake_items ADD COLUMN calcium_mg numeric(24,6) CHECK (calcium_mg >= 0),
  ADD COLUMN iron_mg numeric(24,6) CHECK (iron_mg >= 0), ADD COLUMN dish_profile_snapshot jsonb;

CREATE FUNCTION capture_intake_dish_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.food_ref_id IS NOT DISTINCT FROM OLD.food_ref_id THEN
    RETURN NEW;
  END IF;
  SELECT jsonb_build_object('merchant',m.merchant,'dish',m.dish,'stall',m.stall,
    'groups',m.profile->'groups','staple',m.profile->'staple','revision',f.revision)
    INTO NEW.dish_profile_snapshot
    FROM merchant_foods m JOIN food_references f ON f.id=m.food_id
    WHERE m.food_id=NEW.food_ref_id AND m.subject_id=NEW.subject_id AND f.state='active';
  RETURN NEW;
END
$$;
CREATE TRIGGER intake_dish_profile BEFORE INSERT OR UPDATE OF food_ref_id ON intake_items
  FOR EACH ROW EXECUTE FUNCTION capture_intake_dish_profile();
