BEGIN;

CREATE INDEX IF NOT EXISTS health_sync_cursors_subject_source_idx
  ON health_sync_cursors(subject_id, source_instance_id, device_id, record_type);

COMMIT;
