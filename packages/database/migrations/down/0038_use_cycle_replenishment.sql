DROP INDEX IF EXISTS use_cycles_active_replenishment_idx;
DELETE FROM notifications WHERE source_type='use_cycle';
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('due','processing_failed','reminder'));
ALTER TABLE notifications DROP CONSTRAINT notifications_source_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_source_type_check CHECK (source_type IN ('recurring_occurrence','library_processing_job','manual'));
ALTER TABLE use_cycles DROP CONSTRAINT use_cycles_reminder_check, DROP CONSTRAINT use_cycles_quantity_metadata_check, DROP CONSTRAINT use_cycles_match_check, DROP CONSTRAINT use_cycles_lead_days_check, DROP CONSTRAINT use_cycles_positive_quantities_check, DROP CONSTRAINT use_cycles_quantity_unit_check, DROP CONSTRAINT use_cycles_state_check;
ALTER TABLE use_cycles DROP COLUMN reminder_enabled, DROP COLUMN match_value, DROP COLUMN match_mode, DROP COLUMN time_zone, DROP COLUMN replenish_lead_days, DROP COLUMN replenish_threshold, DROP COLUMN expected_daily_usage, DROP COLUMN quantity_unit, DROP COLUMN initial_quantity;
