CREATE TABLE trip_connections (
  id text PRIMARY KEY,
  day_plan_id text NOT NULL REFERENCES trip_day_plans(id),
  from_stop_id text NOT NULL,
  to_stop_id text,
  reservation_id text REFERENCES reservations(id),
  departure_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('walk','metro','bus','rail','taxi','car','other')),
  travel_minutes integer CHECK (travel_minutes BETWEEN 0 AND 10080),
  buffer_minutes integer NOT NULL CHECK (buffer_minutes BETWEEN 0 AND 10080),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((to_stop_id IS NULL) <> (reservation_id IS NULL)),
  CHECK (to_stop_id IS DISTINCT FROM from_stop_id)
);
CREATE UNIQUE INDEX trip_connection_stop_idx ON trip_connections(day_plan_id,from_stop_id,to_stop_id) WHERE reservation_id IS NULL;
CREATE UNIQUE INDEX trip_connection_booking_idx ON trip_connections(day_plan_id,from_stop_id,reservation_id) WHERE to_stop_id IS NULL;
