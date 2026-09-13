BEGIN;

CREATE TABLE legacy_archives (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  source_instance text NOT NULL,
  source_table text NOT NULL,
  source_snapshot text NOT NULL,
  chunk_no integer NOT NULL CHECK (chunk_no > 0),
  chunk_count integer NOT NULL CHECK (chunk_count > 0 AND chunk_no <= chunk_count),
  row_count integer NOT NULL CHECK (row_count >= 0),
  content jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','deleted')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, source_instance, source_table, source_snapshot, chunk_no)
);

CREATE INDEX legacy_archives_subject_source_idx
  ON legacy_archives(subject_id, source_instance, source_table, source_snapshot, chunk_no);

COMMIT;
