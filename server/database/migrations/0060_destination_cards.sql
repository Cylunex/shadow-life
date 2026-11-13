CREATE TABLE destination_cards (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  on_date date NOT NULL, reservation_id text REFERENCES reservations(id), place_id text REFERENCES places(id),
  local_name text, address text, entrance text, revision integer NOT NULL DEFAULT 1,
  UNIQUE(subject_id,trip_id,on_date), CHECK(reservation_id IS NOT NULL OR place_id IS NOT NULL)
);
