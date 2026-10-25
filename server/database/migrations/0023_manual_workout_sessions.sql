BEGIN;

ALTER TABLE health_workout_sessions
  ALTER COLUMN raw_id DROP NOT NULL,
  ALTER COLUMN raw_version DROP NOT NULL,
  ADD COLUMN plan_id text REFERENCES workout_plans(id);

CREATE INDEX health_workout_sessions_subject_plan_date_idx
  ON health_workout_sessions(subject_id, plan_id, occurred_on DESC, id DESC)
  WHERE effective;

COMMIT;
