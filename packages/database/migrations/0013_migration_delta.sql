-- Preserve source deletions as queryable history instead of physically erasing migrated facts.
ALTER TABLE meals ADD COLUMN state text NOT NULL DEFAULT 'active'
  CHECK (state IN ('active','deleted'));
ALTER TABLE library_items ADD COLUMN state text NOT NULL DEFAULT 'active'
  CHECK (state IN ('active','deleted'));
