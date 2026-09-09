-- Fresh installations remain read-only until the migration cutover gate explicitly opens writes.
-- Existing installations that already accepted operations keep their current epoch and stage.
UPDATE write_epochs epoch
SET stage = 'read_only', epoch = epoch.epoch + 1, updated_at = now()
WHERE epoch.domain IN ('health', 'ledger')
  AND epoch.stage = 'life'
  AND NOT EXISTS (SELECT 1 FROM operations);
