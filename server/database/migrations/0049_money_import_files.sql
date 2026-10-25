CREATE TABLE money_import_files (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  asset_version_id text NOT NULL REFERENCES asset_versions(id),
  identity_hash text NOT NULL,
  source_name text NOT NULL,
  sha256 text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, identity_hash)
);
CREATE TABLE money_import_file_batches (
  file_id text NOT NULL REFERENCES money_import_files(id),
  batch_id text NOT NULL REFERENCES money_import_batches(id),
  PRIMARY KEY (file_id, batch_id)
);
