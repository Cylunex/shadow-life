-- Close the real meal, evidence, health and travel capture loops.
ALTER TABLE intake_items ADD COLUMN fiber_g numeric(24,6);
ALTER TABLE intake_items ADD COLUMN sodium_mg numeric(24,6);
ALTER TABLE intake_items ADD COLUMN consumed_fraction numeric(24,6);
ALTER TABLE intake_items ADD COLUMN effective boolean NOT NULL DEFAULT true;
ALTER TABLE intake_items ADD CONSTRAINT intake_items_consumed_fraction_check CHECK (consumed_fraction IS NULL OR (consumed_fraction >= 0 AND consumed_fraction <= 1));

CREATE TABLE meal_revisions (
  meal_id text NOT NULL REFERENCES meals(id), revision integer NOT NULL,
  snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meal_id, revision)
);
ALTER TABLE meal_source_links ADD COLUMN role text NOT NULL DEFAULT 'evidence';

CREATE TABLE personal_aliases (
  subject_id text NOT NULL REFERENCES principals(id), alias text NOT NULL,
  target_kind text NOT NULL, target_value text NOT NULL, revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject_id, alias)
);

ALTER TABLE health_observations ADD COLUMN position integer NOT NULL DEFAULT 0;
ALTER TABLE health_observations DROP CONSTRAINT IF EXISTS health_observations_raw_id_metric_key_key;
DROP INDEX IF EXISTS health_observations_raw_metric_unique;
CREATE UNIQUE INDEX health_observations_raw_metric_position_unique ON health_observations(raw_id, metric_key, position);

ALTER TABLE reservations ADD COLUMN state text NOT NULL DEFAULT 'confirmed';
ALTER TABLE reservations ADD COLUMN origin text;
ALTER TABLE reservations ADD COLUMN destination text;
ALTER TABLE reservations ADD COLUMN service_number text;
ALTER TABLE reservations ADD COLUMN seat text;
ALTER TABLE reservations ADD COLUMN fare_entry_id text REFERENCES money_entries(id);
ALTER TABLE reservations ADD COLUMN voided_at timestamptz;
CREATE TABLE reservation_revisions (
  reservation_id text NOT NULL REFERENCES reservations(id), revision integer NOT NULL,
  snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(reservation_id, revision)
);
CREATE TABLE trip_segments (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE, mode text NOT NULL,
  origin text NOT NULL, destination text NOT NULL, starts_at timestamptz, ends_at timestamptz,
  distance_km numeric(24,6), note text, source_id text REFERENCES sources(id),
  revision integer NOT NULL DEFAULT 1, voided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_segments_trip_time_idx ON trip_segments(trip_id, starts_at);

CREATE TABLE dining_visit_links (
  subject_id text NOT NULL REFERENCES principals(id),
  meal_id text NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  consumption_record_id text NOT NULL REFERENCES consumption_records(id),
  visit_id text NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  PRIMARY KEY(meal_id, visit_id),
  UNIQUE(subject_id, meal_id, consumption_record_id, visit_id)
);
