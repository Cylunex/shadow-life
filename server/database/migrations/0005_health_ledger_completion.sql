-- Health / Ledger migration control plane and remaining native domain facts.
CREATE TABLE migration_batches (
  id text PRIMARY KEY,
  bundle_hash text NOT NULL,
  source_instance text NOT NULL,
  source_snapshot text NOT NULL,
  target_schema_version text NOT NULL,
  mapper_version text NOT NULL,
  owner_map_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('dry_run','apply','final_delta')),
  stage text NOT NULL CHECK (stage IN ('staged','applying','reconciling','completed','blocked','failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(bundle_hash, mapper_version, owner_map_hash, mode)
);

CREATE TABLE legacy_object_maps (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES migration_batches(id),
  source_instance text NOT NULL,
  source_table text NOT NULL,
  source_pk jsonb NOT NULL,
  source_pk_hash text NOT NULL,
  source_owner text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  group_key jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_instance, source_table, source_pk_hash, source_owner, target_type, role)
);

CREATE TABLE migration_items (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES migration_batches(id),
  source_instance text NOT NULL,
  source_table text NOT NULL,
  source_pk jsonb NOT NULL,
  source_pk_hash text NOT NULL,
  source_revision text,
  payload_hash text NOT NULL,
  target_component text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','applied','replayed','blocked','conflict','archived')),
  target_type text,
  target_id text,
  target_execution_id text,
  last_applied_target_revision integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, source_instance, source_table, source_pk_hash, target_component)
);

CREATE TABLE migration_conflicts (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES migration_batches(id),
  migration_item_id text REFERENCES migration_items(id),
  code text NOT NULL,
  expected jsonb,
  actual jsonb,
  decision text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projection_checkpoints (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  projection text NOT NULL,
  source_set_hash text NOT NULL,
  rule_version text NOT NULL,
  affected_from date,
  affected_to date,
  state text NOT NULL CHECK (state IN ('pending','running','completed','failed','stale')),
  cursor jsonb,
  failure_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, projection, source_set_hash, rule_version)
);

CREATE TABLE food_references (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  per_100g jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id text REFERENCES sources(id),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(subject_id, name)
);

ALTER TABLE intake_items ADD COLUMN food_ref_id text REFERENCES food_references(id);
ALTER TABLE intake_items ADD COLUMN free_text text;
ALTER TABLE intake_items ADD COLUMN amount_g numeric(24,6);
ALTER TABLE intake_items ADD COLUMN protein_g numeric(24,6);
ALTER TABLE intake_items ADD COLUMN fat_g numeric(24,6);
ALTER TABLE intake_items ADD COLUMN carb_g numeric(24,6);
ALTER TABLE intake_items ADD COLUMN provenance text;
ALTER TABLE intake_items ADD COLUMN grouping_origin text;

CREATE TABLE meal_templates (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, name)
);
CREATE TABLE meal_template_items (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,
  position integer NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE(template_id, position)
);

CREATE TABLE assets (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  media_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, subject_id)
);
CREATE TABLE asset_versions (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, sha256)
);
CREATE TABLE asset_blobs (
  asset_version_id text PRIMARY KEY REFERENCES asset_versions(id) ON DELETE CASCADE,
  bytes bytea NOT NULL
);
ALTER TABLE sources ADD CONSTRAINT sources_asset_version_fk FOREIGN KEY(asset_version_id) REFERENCES asset_versions(id) NOT VALID;
CREATE TABLE asset_references (
  asset_id text NOT NULL REFERENCES assets(id),
  subject_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(asset_id, subject_id, target_type, target_id, role),
  FOREIGN KEY(asset_id, subject_id) REFERENCES assets(id, subject_id)
);

CREATE TABLE meal_consumption_links (
  subject_id text NOT NULL REFERENCES principals(id),
  meal_id text NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  consumption_record_id text NOT NULL REFERENCES consumption_records(id),
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meal_id, consumption_record_id),
  UNIQUE(subject_id, meal_id, consumption_record_id)
);
CREATE UNIQUE INDEX meals_id_subject_unique ON meals(id, subject_id);
CREATE UNIQUE INDEX consumption_records_id_subject_unique ON consumption_records(id, subject_id);
ALTER TABLE meal_consumption_links ADD CONSTRAINT meal_consumption_meal_subject_fk FOREIGN KEY(meal_id, subject_id) REFERENCES meals(id, subject_id);
ALTER TABLE meal_consumption_links ADD CONSTRAINT meal_consumption_record_subject_fk FOREIGN KEY(consumption_record_id, subject_id) REFERENCES consumption_records(id, subject_id);

ALTER TABLE budgets ALTER COLUMN category DROP NOT NULL;
ALTER TABLE budgets DROP CONSTRAINT budgets_subject_id_period_category_key;
CREATE UNIQUE INDEX budgets_subject_period_category_unique ON budgets(subject_id, period, category) NULLS NOT DISTINCT;
ALTER TABLE recurring_plans ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE recurring_plans ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE recurring_plans ADD COLUMN interval_days integer;
ALTER TABLE recurring_plans ADD COLUMN state text NOT NULL DEFAULT 'active';
ALTER TABLE recurring_plans ADD COLUMN ended_on date;

CREATE TABLE recurring_occurrences (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES recurring_plans(id),
  due_on date NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','reminded','handled','dismissed','snoozed')),
  linked_record_id text REFERENCES consumption_records(id),
  feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(plan_id, due_on)
);
CREATE TABLE spending_intents (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  title text NOT NULL,
  expected_amount numeric(24,6),
  currency text,
  intended_on date,
  state text NOT NULL,
  linked_record_id text REFERENCES consumption_records(id),
  revision integer NOT NULL DEFAULT 1
);
CREATE TABLE use_cycles (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  purchase_record_id text REFERENCES consumption_records(id),
  item_name text NOT NULL,
  started_on date NOT NULL,
  ended_on date,
  state text NOT NULL,
  revision integer NOT NULL DEFAULT 1
);
CREATE TABLE forecast_runs (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  algorithm_version text NOT NULL,
  as_of timestamptz NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE suggestion_feedback (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  suggestion_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('dismissed','snoozed','handled')),
  snoozed_until timestamptz,
  linked_record_id text REFERENCES consumption_records(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, suggestion_key)
);

CREATE TABLE write_epochs (
  domain text PRIMARY KEY,
  epoch integer NOT NULL CHECK (epoch > 0),
  stage text NOT NULL CHECK (stage IN ('legacy','read_only','life')), 
  target_schema text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO write_epochs(domain, epoch, stage, target_schema)
VALUES ('health',1,'life',current_schema()),('ledger',1,'life',current_schema())
ON CONFLICT(domain) DO NOTHING;
