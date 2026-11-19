-- Older servers can still read the default dish and the food references for other stalls.
DELETE FROM merchant_foods m WHERE EXISTS (
  SELECT 1 FROM merchant_foods prior WHERE prior.subject_id=m.subject_id AND lower(prior.merchant)=lower(m.merchant)
    AND lower(prior.dish)=lower(m.dish) AND (prior.stall IS NULL,prior.food_id)>(m.stall IS NULL,m.food_id)
);
DROP INDEX merchant_food_identity;
CREATE UNIQUE INDEX merchant_food_identity ON merchant_foods(subject_id,lower(merchant),lower(dish));
ALTER TABLE merchant_foods DROP COLUMN profile, DROP COLUMN stall;
DROP TRIGGER intake_dish_profile ON intake_items;
DROP FUNCTION capture_intake_dish_profile();
ALTER TABLE intake_items DROP COLUMN calcium_mg, DROP COLUMN iron_mg, DROP COLUMN dish_profile_snapshot;
