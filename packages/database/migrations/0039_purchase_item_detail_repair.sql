ALTER TABLE purchases ADD COLUMN item_detail_state text NOT NULL DEFAULT 'complete';
ALTER TABLE purchases ADD CONSTRAINT purchases_item_detail_state_check CHECK (item_detail_state IN ('complete','folded','supplemented'));
ALTER TABLE purchase_items ADD COLUMN detail_role text NOT NULL DEFAULT 'item';
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_detail_role_check CHECK (detail_role IN ('item','folded_summary','supplemented_item'));
UPDATE purchase_items SET detail_role='folded_summary' WHERE raw_name ~ '等多件[[:space:]]*$';
UPDATE purchases SET item_detail_state='folded' WHERE EXISTS (SELECT 1 FROM purchase_items item WHERE item.purchase_id=purchases.id AND item.detail_role='folded_summary');
ALTER TABLE use_cycles ADD COLUMN purchase_item_id text REFERENCES purchase_items(id);
CREATE INDEX use_cycles_purchase_item_idx ON use_cycles(purchase_item_id) WHERE purchase_item_id IS NOT NULL;

-- The deterministic suffix only relabels importer summaries; text and money remain
-- untouched. User-confirmed repair adds concrete rows through life.update_purchase_items.
