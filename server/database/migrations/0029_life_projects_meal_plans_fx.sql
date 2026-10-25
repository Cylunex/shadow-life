BEGIN;

CREATE TABLE life_projects (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  title text NOT NULL,
  goal text NOT NULL,
  starts_on date,
  ends_on date,
  state text NOT NULL CHECK (state IN ('active','completed','paused','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  UNIQUE (id, subject_id)
);
CREATE TABLE life_project_revisions (project_id text NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, revision integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id, revision));
CREATE TABLE life_project_milestones (id text PRIMARY KEY, project_id text NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, title text NOT NULL, due_on date, state text NOT NULL CHECK (state IN ('planned','completed','cancelled')), position integer NOT NULL, UNIQUE(project_id, position));
CREATE TABLE life_project_links (project_id text NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, ref_kind text NOT NULL CHECK (ref_kind IN ('trip','health_plan','recurring_plan','owned_item','library_item','money_entry','meal','recipe')), ref_id text NOT NULL, ref_revision integer NOT NULL CHECK (ref_revision > 0), role text NOT NULL, PRIMARY KEY(project_id, ref_kind, ref_id, role));
CREATE TABLE action_items (id text PRIMARY KEY, project_id text NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, subject_id text NOT NULL REFERENCES principals(id), title text NOT NULL, due_on date, state text NOT NULL CHECK (state IN ('open','completed','cancelled')), recurring_occurrence_id text REFERENCES recurring_occurrences(id), health_habit_id text REFERENCES health_habit_definitions(id), revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (num_nonnulls(recurring_occurrence_id, health_habit_id) <= 1));
CREATE INDEX life_projects_subject_state_idx ON life_projects(subject_id, state, updated_at DESC, id DESC);
CREATE INDEX action_items_subject_due_idx ON action_items(subject_id, state, due_on, id);
CREATE UNIQUE INDEX action_items_occurrence_unique ON action_items(subject_id, recurring_occurrence_id) WHERE recurring_occurrence_id IS NOT NULL;

CREATE TABLE meal_plans (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  title text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  time_zone text NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','active','completed','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (id, subject_id)
);
CREATE TABLE meal_plan_revisions (meal_plan_id text NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE, revision integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(meal_plan_id, revision));
CREATE TABLE meal_plan_entries (id text PRIMARY KEY, meal_plan_id text NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE, plan_date date NOT NULL, meal_type text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack','other')), title text NOT NULL, servings numeric(24,6) NOT NULL CHECK (servings > 0), recipe_id text REFERENCES recipes(id), recipe_revision integer CHECK (recipe_revision IS NULL OR recipe_revision > 0), recipe_snapshot jsonb, position integer NOT NULL, CHECK ((recipe_id IS NULL) = (recipe_revision IS NULL) AND (recipe_id IS NULL) = (recipe_snapshot IS NULL)), UNIQUE(meal_plan_id, plan_date, meal_type, position));
CREATE INDEX meal_plan_entries_plan_date_idx ON meal_plan_entries(meal_plan_id, plan_date, position);

CREATE TABLE shopping_lists (id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), meal_plan_id text NOT NULL REFERENCES meal_plans(id), meal_plan_revision integer NOT NULL CHECK (meal_plan_revision > 0), title text NOT NULL, state text NOT NULL CHECK (state IN ('open','completed','cancelled')), revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shopping_list_items (id text PRIMARY KEY, shopping_list_id text NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE, name text NOT NULL, quantity numeric(24,6), unit text, source_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb, state text NOT NULL CHECK (state IN ('needed','bought','skipped')), purchase_item_id text REFERENCES purchase_items(id), revision integer NOT NULL DEFAULT 1, CHECK ((quantity IS NULL) = (unit IS NULL)), CHECK (state='bought' OR purchase_item_id IS NULL));
CREATE INDEX shopping_lists_subject_state_idx ON shopping_lists(subject_id, state, updated_at DESC, id DESC);

CREATE TABLE money_fx_snapshots (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  money_entry_id text NOT NULL UNIQUE REFERENCES money_entries(id),
  original_amount numeric(24,6) NOT NULL CHECK (original_amount > 0),
  original_currency text NOT NULL CHECK (original_currency ~ '^[A-Z]{3}$'),
  base_amount numeric(24,6) NOT NULL CHECK (base_amount > 0),
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  rate numeric(30,12) NOT NULL CHECK (rate > 0),
  quote_convention text NOT NULL CHECK (quote_convention='base_per_original'),
  quoted_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('manual','provider','import')),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_currency <> base_currency)
);
CREATE TABLE trip_money_links (trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE, money_entry_id text NOT NULL UNIQUE REFERENCES money_entries(id), subject_id text NOT NULL REFERENCES principals(id), PRIMARY KEY(trip_id, money_entry_id));
CREATE TABLE shared_expense_allocations (id text PRIMARY KEY, money_entry_id text NOT NULL REFERENCES money_entries(id) ON DELETE CASCADE, subject_id text NOT NULL REFERENCES principals(id), participant_label text NOT NULL, original_amount numeric(24,6) NOT NULL CHECK (original_amount > 0), state text NOT NULL CHECK (state IN ('unsettled','settled','waived')), settled_on date, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), updated_at timestamptz NOT NULL DEFAULT now(), CHECK ((state='settled') = (settled_on IS NOT NULL)));
CREATE INDEX money_fx_subject_created_idx ON money_fx_snapshots(subject_id, created_at DESC, id DESC);

COMMIT;
