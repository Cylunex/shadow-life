BEGIN;

CREATE INDEX IF NOT EXISTS recurring_occurrences_open_due_idx
  ON recurring_occurrences(due_on, plan_id, id)
  WHERE state IN ('pending', 'reminded', 'snoozed');

CREATE INDEX IF NOT EXISTS health_source_instances_subject_permission_idx
  ON health_source_instances(subject_id, permission_state, source_type, instance_key);

CREATE INDEX IF NOT EXISTS trips_subject_date_window_idx
  ON trips(subject_id, starts_on, ends_on, id);

CREATE INDEX IF NOT EXISTS trip_members_subject_trip_idx
  ON trip_members(subject_id, trip_id);

COMMIT;
