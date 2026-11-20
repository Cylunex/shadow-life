ALTER TABLE food_stock_lots ADD COLUMN purchase_item_id text REFERENCES purchase_items(id);
CREATE UNIQUE INDEX food_stock_purchase_item_idx
  ON food_stock_lots(subject_id,purchase_item_id) WHERE purchase_item_id IS NOT NULL;
