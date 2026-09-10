CREATE TABLE agent_context_packs (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  thread_id text REFERENCES threads(id) ON DELETE CASCADE,
  object_refs jsonb NOT NULL CHECK (jsonb_typeof(object_refs) = 'array' AND jsonb_array_length(object_refs) BETWEEN 1 AND 20),
  valid_from timestamptz,
  valid_to timestamptz,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX agent_context_packs_subject_expiry_idx ON agent_context_packs(subject_id,expires_at DESC,id);

CREATE TABLE user_memories (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  category text NOT NULL CHECK (category IN ('explicit_preference','deterministic_aggregate')),
  memory_key text NOT NULL,
  value jsonb NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_refs) = 'array'),
  algorithm_version text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,category,memory_key),
  CHECK ((category = 'deterministic_aggregate') = (algorithm_version IS NOT NULL))
);
CREATE TABLE user_memory_revisions (
  memory_id text NOT NULL REFERENCES user_memories(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(memory_id,revision)
);

CREATE TABLE notification_preferences (
  subject_id text PRIMARY KEY REFERENCES principals(id),
  enabled boolean NOT NULL DEFAULT true,
  quiet_start time,
  quiet_end time,
  time_zone text NOT NULL DEFAULT 'UTC',
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  source_type text NOT NULL CHECK (source_type IN ('recurring_occurrence','library_processing_job','manual')),
  source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('due','processing_failed','reminder')),
  redacted_title text NOT NULL,
  redacted_body text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','snoozed','dismissed','delivered')),
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,source_type,source_id,kind),
  CHECK ((state = 'snoozed') = (snoozed_until IS NOT NULL))
);
CREATE INDEX notifications_subject_state_schedule_idx ON notifications(subject_id,state,scheduled_at,id);
