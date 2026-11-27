CREATE TABLE timeline_upload_members (
  subject_id text NOT NULL REFERENCES principals(id),
  resource_key text NOT NULL,
  batch_id text NOT NULL,
  PRIMARY KEY (subject_id,resource_key)
);

-- A receipt identifies an upload even when independent uploads have identical timestamps.
-- Older single-command HTTP receipts carry no transport batch and stay ungrouped.
INSERT INTO timeline_upload_members(subject_id,resource_key,batch_id)
SELECT DISTINCT ON (subject_id,resource_key) subject_id,resource_key,execution_id
FROM (
  SELECT op.subject_id, op.created_at, op.execution_id,
         CASE item->>'type'
           WHEN 'activity_capture' THEN 'capture:' || (item->>'id')
           WHEN 'health_raw' THEN 'health:' || (item->>'id') || ':' || ((item->>'revision')::bigint - 1)
         END AS resource_key
  FROM operations op
  CROSS JOIN LATERAL jsonb_array_elements(op.result->'resources') item
  WHERE op.capability IN ('life.ingest_activity','health.ingest_batch')
    AND item->>'type' IN ('activity_capture','health_raw')
) members
ORDER BY subject_id,resource_key,created_at,execution_id;

CREATE INDEX money_import_confirmed_record_idx ON money_import_candidates(subject_id,linked_record_id,created_at,id)
WHERE linked_record_id IS NOT NULL AND status='confirmed';
