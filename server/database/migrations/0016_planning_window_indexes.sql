BEGIN;

CREATE INDEX IF NOT EXISTS recurring_plans_subject_due_idx
  ON recurring_plans(subject_id, next_due_on, id);

CREATE INDEX IF NOT EXISTS recurring_occurrences_due_plan_idx
  ON recurring_occurrences(due_on, plan_id, id);

CREATE INDEX IF NOT EXISTS spending_intents_subject_intended_idx
  ON spending_intents(subject_id, intended_on, id);

CREATE INDEX IF NOT EXISTS use_cycles_subject_window_idx
  ON use_cycles(subject_id, started_on, ended_on, id);

COMMIT;
