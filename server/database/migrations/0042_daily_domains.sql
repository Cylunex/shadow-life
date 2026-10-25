BEGIN;

ALTER TABLE action_items ADD COLUMN scheduled_at timestamptz;
ALTER TABLE action_items ADD COLUMN scheduled_time_zone text;
ALTER TABLE action_items ADD CONSTRAINT action_items_schedule_pair CHECK ((scheduled_at IS NULL) = (scheduled_time_zone IS NULL));

ALTER TABLE owned_items ADD COLUMN location_path jsonb;
ALTER TABLE owned_items ADD CONSTRAINT owned_items_location_path_array CHECK (location_path IS NULL OR jsonb_typeof(location_path) = 'array');

ALTER TABLE recipes ADD COLUMN source_url text;

CREATE TABLE food_stock_lots (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  quantity numeric(24,6) NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  expires_on date,
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, subject_id)
);
CREATE TABLE food_stock_lot_revisions (lot_id text NOT NULL REFERENCES food_stock_lots(id) ON DELETE CASCADE, revision integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(lot_id,revision));
CREATE INDEX food_stock_lots_subject_name_idx ON food_stock_lots(subject_id, lower(btrim(name)), unit, expires_on);

COMMIT;
