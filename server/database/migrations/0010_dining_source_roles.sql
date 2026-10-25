CREATE TABLE purchase_source_links(
  purchase_id text NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources(id),
  role text NOT NULL CHECK(role IN('order_screenshot','receipt','evidence')),
  PRIMARY KEY(purchase_id,source_id)
);

ALTER TABLE trips ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reservations ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE visits ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE trip_day_plans ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_measurements ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_observations ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_daily_wellbeing ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_sleep_sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_workout_sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_daily_activity ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_habit_logs ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
