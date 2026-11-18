ALTER TABLE health_daily_summaries
  ADD COLUMN id text GENERATED ALWAYS AS (
    'healthday_' || md5(length(subject_id)::text || ':' || subject_id ||
      ':' || (occurred_on - date '2000-01-01')::text || ':' || algorithm_version)
  ) STORED;
CREATE INDEX health_daily_summary_agent_idx ON health_daily_summaries(subject_id,id);
CREATE INDEX agent_changes_refs_kind_idx ON agent_changes USING gin(refs jsonb_path_ops);

-- Publication uses the same commit-order fence as other Agent changes.
CREATE CONSTRAINT TRIGGER agent_health_daily_insert AFTER INSERT ON health_daily_summaries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION publish_personal_agent_change('health_daily_summary');

CREATE CONSTRAINT TRIGGER agent_health_daily_update AFTER UPDATE ON health_daily_summaries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.revision IS DISTINCT FROM OLD.revision)
  EXECUTE FUNCTION publish_personal_agent_change('health_daily_summary');
