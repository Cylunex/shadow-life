-- Preserve recurrence semantics instead of repeatedly adding a month to an already-clamped date.
ALTER TABLE recurring_plans ADD COLUMN anchor_on date;
UPDATE recurring_plans SET anchor_on = next_due_on WHERE anchor_on IS NULL;
ALTER TABLE recurring_plans ALTER COLUMN anchor_on SET NOT NULL;
ALTER TABLE recurring_plans ADD COLUMN local_time time without time zone;
ALTER TABLE recurring_plans ADD COLUMN missing_date_policy text NOT NULL DEFAULT 'skip'
  CHECK (missing_date_policy IN ('skip','last_day'));
ALTER TABLE recurring_plans ADD COLUMN recurrence_rule text;
UPDATE recurring_plans
SET recurrence_rule = CASE cadence
  WHEN 'daily' THEN 'FREQ=DAILY'
  WHEN 'weekly' THEN 'FREQ=WEEKLY'
  WHEN 'monthly' THEN 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from anchor_on)::integer
  WHEN 'yearly' THEN 'FREQ=YEARLY;BYMONTH=' || extract(month from anchor_on)::integer || ';BYMONTHDAY=' || extract(day from anchor_on)::integer
  WHEN 'interval' THEN 'FREQ=DAILY;INTERVAL=' || coalesce(interval_days, 1)
END
WHERE recurrence_rule IS NULL;
ALTER TABLE recurring_plans ALTER COLUMN recurrence_rule SET NOT NULL;
