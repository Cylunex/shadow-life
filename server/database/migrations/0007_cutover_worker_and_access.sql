-- Transactional cutover guards, recoverable health work and resource grants.
CREATE TABLE health_normalization_queue (
  raw_id text NOT NULL REFERENCES health_raw_records(id) ON DELETE CASCADE,
  raw_version integer NOT NULL,
  normalizer_version text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(raw_id,raw_version,normalizer_version)
);
CREATE INDEX health_normalization_queue_pending_idx ON health_normalization_queue(updated_at) WHERE state IN ('pending','failed');

CREATE TABLE health_daily_summaries (
  subject_id text NOT NULL REFERENCES principals(id), occurred_on date NOT NULL,
  algorithm_version text NOT NULL, result jsonb NOT NULL, source_set_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_id,occurred_on,algorithm_version)
);

CREATE TABLE asset_access_grants (
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  grantee_subject_id text NOT NULL REFERENCES principals(id),
  permission text NOT NULL CHECK(permission IN ('read')),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(asset_id,grantee_subject_id,permission)
);
