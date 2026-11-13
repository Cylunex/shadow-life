CREATE TABLE workout_route_tags (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id),
  workout_id text NOT NULL UNIQUE REFERENCES health_workout_sessions(id) ON DELETE CASCADE,
  route text, duration_basis text NOT NULL CHECK(duration_basis IN ('moving','elapsed','unknown')), revision integer NOT NULL DEFAULT 1
);
CREATE INDEX workout_route_owner ON workout_route_tags(subject_id,route);
CREATE TABLE workout_rest_days (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), occurred_on date NOT NULL,
  time_zone text NOT NULL, is_rest boolean NOT NULL, revision integer NOT NULL DEFAULT 1, UNIQUE(subject_id,occurred_on,time_zone)
);
