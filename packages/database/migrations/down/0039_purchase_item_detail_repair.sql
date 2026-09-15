DROP INDEX IF EXISTS use_cycles_purchase_item_idx;
ALTER TABLE use_cycles DROP COLUMN purchase_item_id;
ALTER TABLE purchase_items DROP CONSTRAINT purchase_items_detail_role_check;
ALTER TABLE purchase_items DROP COLUMN detail_role;
ALTER TABLE purchases DROP CONSTRAINT purchases_item_detail_state_check;
ALTER TABLE purchases DROP COLUMN item_detail_state;
