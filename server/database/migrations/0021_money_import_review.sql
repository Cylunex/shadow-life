BEGIN;

CREATE TABLE money_import_batches (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  source_name text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv', 'json', 'markdown')),
  content_hash text NOT NULL,
  original_content text NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, content_hash)
);

CREATE TABLE money_import_rules (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  match_value text NOT NULL,
  replacements jsonb NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX money_import_rules_subject_match_unique
  ON money_import_rules(subject_id, lower(btrim(match_value)));

CREATE TABLE money_import_candidates (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES money_import_batches(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  position integer NOT NULL CHECK (position >= 0),
  external_id text,
  raw jsonb NOT NULL,
  proposed jsonb NOT NULL,
  issues jsonb NOT NULL,
  warnings jsonb NOT NULL,
  applied_rule_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'invalid', 'confirmed', 'ignored')),
  duplicate_of_record_id text REFERENCES consumption_records(id),
  linked_record_id text REFERENCES consumption_records(id),
  decision_reason text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, position)
);

CREATE INDEX money_import_candidates_batch_position_idx
  ON money_import_candidates(batch_id, position);

CREATE INDEX money_import_candidates_subject_external_idx
  ON money_import_candidates(subject_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;
