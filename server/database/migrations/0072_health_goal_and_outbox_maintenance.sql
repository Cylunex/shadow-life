ALTER TABLE health_goals ADD COLUMN updated_at timestamptz;
UPDATE health_goals SET updated_at = created_at;
ALTER TABLE health_goals ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX outbox_delivered_health_raw_idx ON outbox(delivered_at)
  WHERE event_type = 'health.ingest_raw.committed' AND delivered_at IS NOT NULL;
