CREATE TABLE merchant_foods (
  food_id text PRIMARY KEY REFERENCES food_references(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),merchant text NOT NULL,dish text NOT NULL
);
CREATE UNIQUE INDEX merchant_food_identity ON merchant_foods(subject_id,lower(merchant),lower(dish));
CREATE INDEX merchant_food_pages ON merchant_foods(subject_id,lower(merchant),food_id);
CREATE TABLE merchant_food_evidence (
  food_id text NOT NULL REFERENCES merchant_foods(food_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('meal_intake','menu_photo','note')),source_key text NOT NULL,
  meal_id text REFERENCES meals(id),intake_id text REFERENCES intake_items(id),library_item_id text REFERENCES library_items(id),
  note text, PRIMARY KEY(food_id,kind,source_key)
);
