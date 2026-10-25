-- Preserve the immutable 0001 migration while completing the single-version contract additively.
-- The old value remains internal-only so a compatible current command can replay its durable receipt.
ALTER TABLE operations RENAME COLUMN capability_version TO legacy_capability_version;
ALTER TABLE operations ALTER COLUMN legacy_capability_version DROP NOT NULL;
UPDATE operations
SET result = (result - 'capability_version') || jsonb_build_object('protocol','shadow.execution-result')
WHERE result->>'protocol' = 'shadow.execution-result.v2';
UPDATE outbox SET event_type = regexp_replace(event_type,'\.v[0-9]+$','') WHERE event_type ~ '\.v[0-9]+$';

-- Daily summaries are rebuilt from every health fact source through this durable invalidation queue.
CREATE INDEX IF NOT EXISTS health_projection_invalidations_pending_idx
  ON health_projection_invalidations(updated_at)
  WHERE valid = false;
