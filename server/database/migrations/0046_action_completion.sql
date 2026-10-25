ALTER TABLE action_items ADD COLUMN completed_at timestamptz;
UPDATE action_items SET completed_at=updated_at WHERE state='completed';
