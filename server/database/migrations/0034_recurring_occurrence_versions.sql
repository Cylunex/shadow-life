BEGIN;

ALTER TABLE recurring_occurrences
  ADD COLUMN original_due_on date,
  ADD COLUMN effective_due_on date,
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

UPDATE recurring_occurrences
SET original_due_on = due_on,
    effective_due_on = due_on;

ALTER TABLE recurring_occurrences
  ALTER COLUMN original_due_on SET NOT NULL,
  ALTER COLUMN effective_due_on SET NOT NULL;

CREATE INDEX recurring_occurrences_effective_due_idx
  ON recurring_occurrences(effective_due_on, state, plan_id, id);

COMMIT;
