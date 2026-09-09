-- Immutable published plans and per-member runtime state keep on-trip execution stable.
CREATE TABLE trip_revisions (
  trip_id text NOT NULL REFERENCES trips(id), revision integer NOT NULL,
  snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(trip_id,revision)
);

CREATE TABLE trip_plan_versions (
  id text PRIMARY KEY, trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id), version integer NOT NULL CHECK(version>0),
  label text, note text, snapshot jsonb NOT NULL, content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_id,version), UNIQUE(id,trip_id)
);

CREATE TABLE trip_runs (
  id text PRIMARY KEY, trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id), plan_version_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('active','completed','abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(id,subject_id),
  FOREIGN KEY(plan_version_id,trip_id) REFERENCES trip_plan_versions(id,trip_id)
);
CREATE UNIQUE INDEX trip_runs_one_active_per_member ON trip_runs(trip_id,subject_id) WHERE state='active';

CREATE TABLE trip_stop_outcomes (
  run_id text NOT NULL, subject_id text NOT NULL REFERENCES principals(id), stop_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('arrived','skipped')), occurred_at timestamptz, note text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,stop_id),
  FOREIGN KEY(run_id,subject_id) REFERENCES trip_runs(id,subject_id)
);
