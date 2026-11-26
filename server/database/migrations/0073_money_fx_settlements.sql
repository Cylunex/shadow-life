BEGIN;

CREATE TABLE money_fx_settlements (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  money_entry_id text NOT NULL UNIQUE REFERENCES money_entries(id),
  amount numeric(24,2) NOT NULL CHECK (amount > 0),
  settled_on date NOT NULL,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
