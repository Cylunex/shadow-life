CREATE TABLE library_processing_jobs (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  source_asset_version_id text NOT NULL REFERENCES asset_versions(id),
  kind text NOT NULL CHECK (kind IN ('text_extract','ocr','transcript')),
  requested_processor text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  derived_asset_version_id text REFERENCES asset_versions(id),
  processor_version text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,item_id,source_asset_version_id,kind,requested_processor),
  CHECK ((state = 'completed') = (derived_asset_version_id IS NOT NULL AND processor_version IS NOT NULL))
);

CREATE INDEX library_processing_jobs_claim_idx ON library_processing_jobs(state,updated_at,id);

CREATE TABLE library_snippets (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES library_processing_jobs(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  item_revision integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  locator jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,ordinal),
  FOREIGN KEY(item_id,item_revision) REFERENCES library_revisions(item_id,revision)
);

CREATE INDEX library_snippets_item_idx ON library_snippets(subject_id,item_id,item_revision,ordinal);
CREATE INDEX library_snippets_text_search_idx ON library_snippets USING gin(to_tsvector('simple',text));
CREATE INDEX library_revisions_text_search_idx ON library_revisions USING gin(to_tsvector('simple',coalesce(text,'')));

CREATE TABLE library_reading_states (
  item_id text NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  item_revision integer NOT NULL,
  locator jsonb NOT NULL,
  progress numeric(7,6) NOT NULL CHECK (progress >= 0 AND progress <= 1),
  state text NOT NULL CHECK (state IN ('active','completed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(item_id,subject_id),
  FOREIGN KEY(item_id,item_revision) REFERENCES library_revisions(item_id,revision)
);

CREATE TABLE library_legacy_links (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  legacy_uri text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('ed25519-sha256-ascii-v1','legacy-unverified')),
  source_asset_version_id text REFERENCES asset_versions(id),
  signed_content_sha256 text,
  public_key_pem text,
  signature_base64 text,
  verification_state text NOT NULL CHECK (verification_state IN ('verified','invalid','unverified')),
  verification_error text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,legacy_uri),
  CHECK (
    (algorithm = 'legacy-unverified' AND verification_state = 'unverified') OR
    (algorithm = 'ed25519-sha256-ascii-v1' AND source_asset_version_id IS NOT NULL AND signed_content_sha256 IS NOT NULL AND public_key_pem IS NOT NULL AND signature_base64 IS NOT NULL AND verification_state IN ('verified','invalid'))
  )
);

CREATE INDEX library_legacy_links_item_idx ON library_legacy_links(subject_id,item_id);
