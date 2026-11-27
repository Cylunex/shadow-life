ALTER TABLE capture_screenshot_sources ADD COLUMN batch_id text;

-- Only first-revision capture tags and immutable Android command identities
-- describe the original gesture. Capture time and edited titles do not.
UPDATE capture_screenshot_sources AS shot
SET batch_id = source.batch_id
FROM (
  SELECT shot.item_id, coalesce(
    (SELECT substring(tag from 13) FROM jsonb_array_elements_text(rev.tags) tag
     WHERE tag ~ '^losna:batch:[a-z][a-z0-9_]{7,127}$' LIMIT 1),
    substring(op.command_id from '^cmd_(order_[a-f0-9]{32})(?:_[0-9]+)?$'),
    'share_' || substring(op.command_id from '^cmd_android_share_([a-f0-9]{32})_[0-9]+$')
  ) AS batch_id
  FROM capture_screenshot_sources shot
  JOIN library_revisions rev ON rev.item_id=shot.item_id AND rev.revision=1
  LEFT JOIN operations op ON op.subject_id=shot.subject_id AND op.capability='life.capture_screenshot'
    AND op.result->'actual_values'->>'library_item_id'=shot.item_id
) source WHERE source.item_id=shot.item_id AND source.batch_id IS NOT NULL;
