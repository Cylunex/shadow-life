BEGIN;

CREATE TABLE owned_items (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  purchase_item_id text REFERENCES purchase_items(id),
  name text NOT NULL,
  ownership_state text NOT NULL CHECK (ownership_state IN ('owned','gifted','returned','disposed','lost')),
  location text,
  started_on date,
  warranty_ends_on date,
  return_by date,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, subject_id)
);
CREATE INDEX owned_items_subject_state_idx ON owned_items(subject_id, ownership_state, updated_at DESC, id DESC);
CREATE INDEX owned_items_purchase_item_idx ON owned_items(purchase_item_id) WHERE purchase_item_id IS NOT NULL;

CREATE TABLE owned_item_revisions (
  owned_item_id text NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owned_item_id, revision)
);

CREATE TABLE owned_item_documents (
  owned_item_id text NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
  library_item_id text NOT NULL REFERENCES library_items(id),
  library_revision integer NOT NULL CHECK (library_revision > 0),
  role text NOT NULL CHECK (role IN ('receipt','manual','warranty','repair')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owned_item_id, library_item_id, role)
);

CREATE TABLE owned_item_events (
  id text PRIMARY KEY,
  owned_item_id text NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES principals(id),
  event_kind text NOT NULL CHECK (event_kind IN ('maintenance','repair','return','dispose','gift','lost','restore','note')),
  occurred_on date NOT NULL,
  note text NOT NULL,
  cost_entry_id text REFERENCES money_entries(id),
  document_library_item_id text REFERENCES library_items(id),
  document_library_revision integer CHECK (document_library_revision IS NULL OR document_library_revision > 0),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_library_item_id IS NULL) = (document_library_revision IS NULL))
);
CREATE INDEX owned_item_events_item_date_idx ON owned_item_events(owned_item_id, occurred_on DESC, id DESC);

CREATE TABLE life_reviews (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  from_on date NOT NULL,
  to_on date NOT NULL,
  time_zone text NOT NULL,
  domain_signature text NOT NULL,
  domains jsonb NOT NULL,
  algorithm_version text NOT NULL,
  metrics jsonb NOT NULL,
  coverage jsonb NOT NULL,
  evidence jsonb NOT NULL,
  limitations jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_on >= from_on),
  UNIQUE (subject_id, from_on, to_on, time_zone, domain_signature, algorithm_version)
);
CREATE INDEX life_reviews_subject_period_idx ON life_reviews(subject_id, to_on DESC, from_on DESC, id DESC);

CREATE TABLE life_review_revisions (
  review_id text NOT NULL REFERENCES life_reviews(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (review_id, revision)
);

COMMIT;
