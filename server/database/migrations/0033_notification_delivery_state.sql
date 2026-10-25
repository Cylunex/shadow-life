CREATE TABLE notification_installations (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  platform text NOT NULL CHECK (platform IN ('android')),
  authorization_state text NOT NULL CHECK (authorization_state IN ('enabled','denied','unavailable')),
  push_token text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,id)
);

CREATE TABLE notification_read_states (
  subject_id text NOT NULL REFERENCES principals(id),
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('unread','read')),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_id,notification_id)
);

CREATE TABLE notification_deliveries (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  installation_id text NOT NULL REFERENCES notification_installations(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('scheduled','delivered','failed','cancelled','unknown')),
  provider_reference text,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,installation_id)
);
CREATE INDEX notification_deliveries_subject_state_idx ON notification_deliveries(subject_id,state,updated_at,id);

