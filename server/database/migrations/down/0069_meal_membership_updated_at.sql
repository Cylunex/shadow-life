DROP TRIGGER meal_membership_update ON meals;
DROP FUNCTION track_meal_membership_update();
ALTER TABLE meals DROP COLUMN membership_updated_at;
