DROP TABLE food_stock_lot_revisions;
DROP TABLE food_stock_lots;
ALTER TABLE recipes DROP COLUMN source_url;
ALTER TABLE owned_items DROP CONSTRAINT owned_items_location_path_array, DROP COLUMN location_path;
ALTER TABLE action_items DROP CONSTRAINT action_items_schedule_pair, DROP COLUMN scheduled_time_zone, DROP COLUMN scheduled_at;
