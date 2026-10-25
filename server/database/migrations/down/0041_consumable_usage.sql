DROP TABLE consumable_use_revisions;
DROP TABLE use_cycle_revisions;
DROP TABLE consumable_uses;
ALTER TABLE use_cycles DROP CONSTRAINT use_cycles_pending_check, DROP CONSTRAINT use_cycles_subject_unique,
  DROP COLUMN usage_state,DROP COLUMN quantity_label,DROP COLUMN note;
