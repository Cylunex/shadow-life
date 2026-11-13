CREATE TABLE purchase_price_specs (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), purchase_item_id text NOT NULL UNIQUE REFERENCES purchase_items(id) ON DELETE CASCADE,
  product text NOT NULL, pack_count numeric(18,6) NOT NULL CHECK(pack_count>0),
  pack_size numeric(18,6) NOT NULL CHECK(pack_size>0), unit text NOT NULL CHECK(unit IN ('g','kg','ml','L','件')),
  price_basis text NOT NULL CHECK(price_basis IN ('listed','paid')), discount numeric(24,6) NOT NULL DEFAULT 0 CHECK(discount>=0),
  revision integer NOT NULL DEFAULT 1
);
CREATE INDEX purchase_price_product ON purchase_price_specs(subject_id,product);
