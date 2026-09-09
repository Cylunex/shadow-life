BEGIN;
CREATE TABLE health_observations (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  metric_key text NOT NULL, value numeric(24,6) NOT NULL, unit text NOT NULL, occurred_on date NOT NULL, occurred_at timestamptz, time_zone text NOT NULL,
  group_id text NOT NULL, group_kind text NOT NULL, original_field text, autofilled boolean NOT NULL DEFAULT false, effective boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1, UNIQUE(raw_id,metric_key)
);
CREATE INDEX health_observations_subject_metric_date_idx ON health_observations(subject_id,metric_key,occurred_on DESC,id DESC) WHERE effective;
CREATE TABLE health_daily_wellbeing (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL UNIQUE REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  occurred_on date NOT NULL, time_zone text NOT NULL, mood_score integer CHECK(mood_score BETWEEN 0 AND 10), energy_level integer CHECK(energy_level BETWEEN 0 AND 10),
  sleep_quality integer CHECK(sleep_quality BETWEEN 0 AND 10), morning_erection boolean, notes text, effective boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1
);
CREATE TABLE health_sleep_sessions (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL UNIQUE REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  wake_date date NOT NULL, time_zone text NOT NULL, started_at timestamptz, ended_at timestamptz, total_minutes integer NOT NULL CHECK(total_minutes>=0),
  deep_minutes integer CHECK(deep_minutes>=0), light_minutes integer CHECK(light_minutes>=0), rem_minutes integer CHECK(rem_minutes>=0), awake_minutes integer CHECK(awake_minutes>=0),
  effective boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1, CHECK(started_at IS NULL OR ended_at IS NULL OR ended_at>=started_at)
);
CREATE INDEX health_sleep_subject_wake_idx ON health_sleep_sessions(subject_id,wake_date DESC,id DESC) WHERE effective;
CREATE TABLE health_workout_sessions (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL UNIQUE REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  occurred_on date NOT NULL, time_zone text NOT NULL, session_type text NOT NULL, started_at timestamptz, duration_minutes integer CHECK(duration_minutes>=0),
  distance_km numeric(24,6), calories_kcal numeric(24,6), rpe integer CHECK(rpe BETWEEN 0 AND 10), heart_rate_avg integer CHECK(heart_rate_avg>0), detail jsonb,
  effective boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1
);
CREATE TABLE health_daily_activity (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL UNIQUE REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  occurred_on date NOT NULL, time_zone text NOT NULL, steps integer CHECK(steps>=0), active_minutes integer CHECK(active_minutes>=0), device_calories_kcal numeric(24,6),
  workout_calories_kcal numeric(24,6), effective_calories_kcal numeric(24,6), field_sources jsonb NOT NULL DEFAULT '{}', effective boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1
);
CREATE TABLE health_habit_logs (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), raw_id text NOT NULL UNIQUE REFERENCES health_raw_records(id), raw_version bigint NOT NULL,
  occurred_on date NOT NULL, time_zone text NOT NULL, habit_key text NOT NULL, done_count integer NOT NULL CHECK(done_count>=0), explicit_denial boolean NOT NULL DEFAULT false,
  note text, effective boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1, CHECK(NOT explicit_denial OR done_count=0)
);
CREATE TABLE health_normalization_steps (
  raw_id text NOT NULL REFERENCES health_raw_records(id), raw_version bigint NOT NULL, normalizer_version text NOT NULL, state text NOT NULL CHECK(state IN ('completed','failed','stale','deleted')),
  affected_dates jsonb NOT NULL DEFAULT '[]', error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(raw_id,raw_version,normalizer_version)
);
CREATE TABLE health_projection_invalidations (
  subject_id text NOT NULL REFERENCES principals(id), occurred_on date NOT NULL, projection_key text NOT NULL, algorithm_version text NOT NULL,
  valid boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject_id,occurred_on,projection_key,algorithm_version)
);
COMMIT;
