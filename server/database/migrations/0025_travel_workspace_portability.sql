CREATE TABLE travel_maps(
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  title text NOT NULL,
  description text,
  state text NOT NULL DEFAULT 'active' CHECK(state IN('active','archived')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX travel_maps_subject_state_idx ON travel_maps(subject_id,state,updated_at DESC);

CREATE TABLE travel_map_items(
  map_id text NOT NULL REFERENCES travel_maps(id) ON DELETE CASCADE,
  place_id text NOT NULL REFERENCES places(id),
  position integer NOT NULL CHECK(position>=0),
  status text NOT NULL CHECK(status IN('candidate','anchor','planned','visited')),
  note text,
  PRIMARY KEY(map_id,place_id),
  UNIQUE(map_id,position)
);

CREATE TABLE travel_map_revisions(
  map_id text NOT NULL REFERENCES travel_maps(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(map_id,revision)
);

CREATE TABLE trip_tracks(
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  points jsonb NOT NULL,
  original_sha256 text NOT NULL CHECK(original_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_tracks_trip_created_idx ON trip_tracks(trip_id,created_at,id);

ALTER TABLE reservations ADD COLUMN visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN('shared','private'));
ALTER TABLE trip_segments ADD COLUMN visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN('shared','private'));
ALTER TABLE visits ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN('shared','private'));
CREATE INDEX reservations_trip_visibility_idx ON reservations(trip_id,visibility,created_at);
CREATE INDEX trip_segments_trip_visibility_idx ON trip_segments(trip_id,visibility,created_at);
CREATE INDEX visits_trip_visibility_idx ON visits(trip_id,visibility,occurred_on,created_at);
