DROP TRIGGER agent_health_daily_update ON health_daily_summaries;
DROP TRIGGER agent_health_daily_insert ON health_daily_summaries;
DROP INDEX health_daily_summary_agent_idx;
DROP INDEX agent_changes_refs_kind_idx;
ALTER TABLE health_daily_summaries DROP COLUMN id;
DELETE FROM agent_changes WHERE event_type='health_daily_summary.changed';
