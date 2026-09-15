ALTER TABLE use_cycles
  ADD COLUMN initial_quantity numeric(24,6),
  ADD COLUMN quantity_unit text,
  ADD COLUMN expected_daily_usage numeric(24,6),
  ADD COLUMN replenish_threshold numeric(24,6),
  ADD COLUMN replenish_lead_days integer,
  ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Shanghai',
  ADD COLUMN match_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN match_value text,
  ADD COLUMN reminder_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE use_cycles
  ADD CONSTRAINT use_cycles_state_check CHECK (state IN ('active','completed','discarded','replenished')),
  ADD CONSTRAINT use_cycles_quantity_unit_check CHECK (quantity_unit IS NULL OR quantity_unit IN ('g','ml','count')),
  ADD CONSTRAINT use_cycles_positive_quantities_check CHECK ((initial_quantity IS NULL OR initial_quantity>0) AND (expected_daily_usage IS NULL OR expected_daily_usage>0) AND (replenish_threshold IS NULL OR replenish_threshold>0)),
  ADD CONSTRAINT use_cycles_lead_days_check CHECK (replenish_lead_days IS NULL OR replenish_lead_days BETWEEN 0 AND 365),
  ADD CONSTRAINT use_cycles_match_check CHECK ((match_mode='none' AND match_value IS NULL) OR (match_mode IN ('exact_name','food_ref') AND match_value IS NOT NULL)),
  ADD CONSTRAINT use_cycles_quantity_metadata_check CHECK ((initial_quantity IS NULL AND expected_daily_usage IS NULL AND replenish_threshold IS NULL) OR quantity_unit IS NOT NULL),
  ADD CONSTRAINT use_cycles_reminder_check CHECK (NOT reminder_enabled OR (match_mode<>'none' AND (replenish_threshold IS NOT NULL OR replenish_lead_days IS NOT NULL)));

ALTER TABLE notifications DROP CONSTRAINT notifications_source_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_source_type_check CHECK (source_type IN ('recurring_occurrence','library_processing_job','use_cycle','manual'));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('due','processing_failed','replenishment','reminder'));

CREATE INDEX use_cycles_active_replenishment_idx ON use_cycles(subject_id,state,reminder_enabled,started_on,id) WHERE state='active';

-- Existing rows intentionally remain match_mode='none' and reminder_enabled=false, so
-- applying this migration cannot reinterpret historical intake as consumption.
