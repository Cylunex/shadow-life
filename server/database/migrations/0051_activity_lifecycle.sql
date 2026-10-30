ALTER TABLE activity_captures ADD COLUMN deleted_at timestamptz;
ALTER TABLE activity_captures ADD COLUMN library_item_id text REFERENCES library_items(id);
