UPDATE meals SET state = 'deleted' WHERE state = 'voided';
ALTER TABLE meals DROP CONSTRAINT meals_state_check,
  ADD CONSTRAINT meals_state_check CHECK (state IN ('active', 'deleted'));
