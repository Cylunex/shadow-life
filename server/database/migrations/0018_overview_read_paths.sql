BEGIN;

CREATE INDEX IF NOT EXISTS money_entries_subject_timeline_idx
  ON money_entries(subject_id, occurred_on DESC, id DESC);

CREATE INDEX IF NOT EXISTS health_measurements_subject_timeline_idx
  ON health_measurements(subject_id, occurred_on DESC, id DESC)
  WHERE effective;

CREATE INDEX IF NOT EXISTS visits_subject_timeline_idx
  ON visits(subject_id, occurred_on DESC, id DESC);

CREATE INDEX IF NOT EXISTS library_items_subject_timeline_idx
  ON library_items(subject_id, created_at DESC, id DESC);

COMMIT;
