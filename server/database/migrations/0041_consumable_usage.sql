ALTER TABLE use_cycles
  ADD COLUMN usage_state text NOT NULL DEFAULT 'in_use' CHECK (usage_state IN ('pending','in_use')),
  ADD COLUMN quantity_label text,
  ADD COLUMN note text,
  ADD CONSTRAINT use_cycles_subject_unique UNIQUE(id,subject_id),
  ADD CONSTRAINT use_cycles_pending_check CHECK (usage_state<>'pending' OR (match_mode='none' AND NOT reminder_enabled));
CREATE TABLE consumable_uses (
  id text PRIMARY KEY,
  cycle_id text NOT NULL,
  subject_id text NOT NULL,
  occurred_on date NOT NULL,
  quantity numeric(24,6) NOT NULL CHECK(quantity>0),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','voided')),
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(cycle_id,subject_id) REFERENCES use_cycles(id,subject_id)
);
CREATE INDEX consumable_uses_cycle_idx ON consumable_uses(cycle_id,occurred_on DESC,id DESC);
CREATE TABLE use_cycle_revisions (
  cycle_id text NOT NULL REFERENCES use_cycles(id),revision integer NOT NULL,snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(cycle_id,revision)
);
CREATE TABLE consumable_use_revisions (
  use_id text NOT NULL REFERENCES consumable_uses(id),revision integer NOT NULL,snapshot jsonb NOT NULL,reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(use_id,revision)
);
