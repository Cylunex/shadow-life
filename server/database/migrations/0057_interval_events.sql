CREATE TABLE interval_events (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), name text NOT NULL,
  archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
  UNIQUE(subject_id,id)
);
CREATE INDEX interval_events_owner ON interval_events(subject_id,id);
CREATE TABLE interval_occurrences (
  id text PRIMARY KEY, subject_id text NOT NULL, event_id text NOT NULL, occurred_on date,
  occurred_at timestamptz, time_zone text NOT NULL, note text, source_kind text, source_id text,
  voided boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
  FOREIGN KEY(subject_id,event_id) REFERENCES interval_events(subject_id,id),
  CHECK ((source_kind IS NULL)=(source_id IS NULL)),
  CHECK (source_kind IN ('service_card_use','owned_item_event')),
  CHECK ((source_kind IS NULL)=(occurred_on IS NOT NULL)),
  UNIQUE(event_id,source_kind,source_id)
);
CREATE INDEX interval_occurrences_date ON interval_occurrences(subject_id,event_id,occurred_on DESC,id DESC);
