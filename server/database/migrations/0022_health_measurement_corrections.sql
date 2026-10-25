BEGIN;

CREATE TABLE health_measurement_revisions (
  measurement_id text NOT NULL REFERENCES health_measurements(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(measurement_id, revision)
);

COMMIT;
