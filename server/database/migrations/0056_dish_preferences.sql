CREATE TABLE dish_preferences (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  shop_source text NOT NULL,
  shop_name text NOT NULL,
  dish_name text NOT NULL,
  preference text NOT NULL CHECK (preference IN ('repeat','avoid','try','cleared')),
  note text,
  purchase_item_id text REFERENCES purchase_items(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,shop_source,shop_name,dish_name)
);
CREATE INDEX dish_preferences_recent ON dish_preferences(subject_id,updated_at DESC,id DESC);
