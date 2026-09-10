-- Interval counts remain distinct from legacy device daily totals.
ALTER TABLE health_daily_activity ADD COLUMN steps_started_at timestamptz;
ALTER TABLE health_daily_activity ADD COLUMN steps_ended_at timestamptz;
ALTER TABLE health_daily_activity ADD COLUMN steps_origin text;
ALTER TABLE health_daily_activity ADD CONSTRAINT health_activity_interval_complete CHECK (
  (steps_started_at IS NULL AND steps_ended_at IS NULL AND steps_origin IS NULL) OR
  (steps_started_at IS NOT NULL AND steps_ended_at > steps_started_at AND steps_origin IS NOT NULL AND steps IS NOT NULL)
);
CREATE TABLE health_rescan_generations (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  source_instance_id text NOT NULL REFERENCES health_source_instances(id),
  device_id text NOT NULL,
  record_type text NOT NULL,
  sync_epoch integer NOT NULL,
  permission_fingerprint text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL CHECK (window_end > window_start),
  complete boolean NOT NULL CHECK (complete),
  observed_ids jsonb NOT NULL,
  absent_ids jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_rescan_source_idx ON health_rescan_generations(subject_id,source_instance_id,record_type,completed_at DESC);
