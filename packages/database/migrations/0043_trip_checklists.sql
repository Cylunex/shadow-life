CREATE TABLE trip_checklists (
  id text PRIMARY KEY,
  trip_id text NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  updated_by text NOT NULL REFERENCES principals(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(items) = 'array')
);
CREATE TABLE trip_checklist_revisions (
  checklist_id text NOT NULL REFERENCES trip_checklists(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (checklist_id, revision)
);
