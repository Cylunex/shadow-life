CREATE TABLE service_cards (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  merchant_name text,
  purchase_record_id text REFERENCES consumption_records(id),
  total_units integer NOT NULL CHECK (total_units BETWEEN 1 AND 1000000),
  unit_label text NOT NULL DEFAULT '次',
  started_on date NOT NULL,
  expires_on date CHECK (expires_on IS NULL OR expires_on >= started_on),
  time_zone text NOT NULL DEFAULT 'Asia/Shanghai',
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, subject_id)
);
CREATE INDEX service_cards_owner_idx ON service_cards(subject_id, id);
CREATE INDEX service_cards_purchase_idx ON service_cards(subject_id, purchase_record_id);

CREATE TABLE service_card_uses (
  id text PRIMARY KEY,
  card_id text NOT NULL,
  subject_id text NOT NULL,
  occurred_on date NOT NULL,
  units integer NOT NULL CHECK (units BETWEEN 1 AND 1000000),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','voided')),
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (card_id, subject_id) REFERENCES service_cards(id, subject_id)
);
CREATE INDEX service_card_uses_card_idx ON service_card_uses(card_id, occurred_on DESC, id DESC);

CREATE TABLE service_card_revisions (
  card_id text NOT NULL REFERENCES service_cards(id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, revision)
);
CREATE TABLE service_card_use_revisions (
  use_id text NOT NULL REFERENCES service_card_uses(id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (use_id, revision)
);
