BEGIN;

ALTER TABLE food_references ADD COLUMN serving_amount numeric(24,6);
ALTER TABLE food_references ADD COLUMN serving_unit text;
ALTER TABLE food_references ADD COLUMN nutrients jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE food_references ADD COLUMN provenance text;
ALTER TABLE food_references ADD COLUMN state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived'));
ALTER TABLE food_references ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE food_references ADD CONSTRAINT food_references_serving_pair CHECK ((serving_amount IS NULL) = (serving_unit IS NULL));
UPDATE food_references SET nutrients=per_100g WHERE nutrients='{}'::jsonb AND per_100g<>'{}'::jsonb;

CREATE INDEX food_references_subject_normalized_name_idx ON food_references(subject_id, lower(btrim(name)));

CREATE TABLE food_revisions (
  food_id text NOT NULL REFERENCES food_references(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(food_id, revision)
);

CREATE TABLE recipes (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  title text NOT NULL,
  servings numeric(24,6) NOT NULL CHECK (servings > 0),
  instructions text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_items (
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY(recipe_id, position)
);

CREATE TABLE recipe_revisions (
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(recipe_id, revision)
);

CREATE INDEX recipes_subject_updated_idx ON recipes(subject_id, updated_at DESC, id DESC);

COMMIT;
