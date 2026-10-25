BEGIN;

CREATE INDEX IF NOT EXISTS meals_subject_timeline_idx
  ON meals(subject_id, occurred_on DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS money_entries_subject_budget_period_idx
  ON money_entries(subject_id, currency, occurred_on, category)
  WHERE entry_type = 'expense';

COMMIT;
