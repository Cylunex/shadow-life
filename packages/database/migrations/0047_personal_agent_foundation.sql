BEGIN;
CREATE TABLE agent_intentions (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), scope text NOT NULL,
  business_key text NOT NULL, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,scope,business_key)
);
CREATE TABLE agent_tasks (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), scope text NOT NULL,
  business_key text NOT NULL, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  lease_token text, lease_client_id text, lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,scope,business_key),
  CHECK(num_nonnulls(lease_token,lease_client_id,lease_expires_at) IN (0,3))
);
CREATE TABLE agent_learning (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), scope text NOT NULL,
  business_key text NOT NULL, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,scope,business_key)
);
CREATE TABLE agent_subscriptions (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), scope text NOT NULL,
  business_key text NOT NULL, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,business_key)
);
CREATE TABLE agent_foundation_history (
  subject_id text NOT NULL REFERENCES principals(id), kind text NOT NULL, object_id text NOT NULL,
  revision integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject_id,kind,object_id,revision)
);
CREATE TABLE agent_changes (
  sequence bigserial PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), event_id text NOT NULL UNIQUE,
  event_type text NOT NULL, refs jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_changes_subject_sequence_idx ON agent_changes(subject_id,sequence);
CREATE TABLE agent_change_cursors (
  subject_id text NOT NULL REFERENCES principals(id), consumer text NOT NULL,
  cursor bigint NOT NULL DEFAULT 0 CHECK(cursor>=0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_id,consumer)
);
ALTER TABLE operations ADD COLUMN actor_id text;
ALTER TABLE operations ADD COLUMN client_id text;
ALTER TABLE health_source_instances ADD COLUMN agent_revision integer NOT NULL DEFAULT 1;
CREATE FUNCTION advance_health_source_agent_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'agent_revision') IS DISTINCT FROM (to_jsonb(OLD)-'agent_revision') THEN
    NEW.agent_revision := OLD.agent_revision+1;
  ELSE NEW.agent_revision := OLD.agent_revision;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER health_source_agent_revision BEFORE UPDATE ON health_source_instances FOR EACH ROW EXECUTE FUNCTION advance_health_source_agent_revision();
-- Defer publication until commit, after business row locks have been acquired.
-- The transaction-scoped lock orders sequence allocation through commit, preventing
-- late commits from appearing behind a consumer cursor. Repeated writes of the same
-- revision within one transaction produce a single change, including lease updates.
CREATE FUNCTION publish_personal_agent_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value jsonb; object_id text; subject text; object_revision integer; event_key text;
BEGIN
  value := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  object_id := value->>'id'; subject := value->>'subject_id';
  object_revision := coalesce((value->>'revision')::integer,(value->>'current_revision')::integer,(value->>'agent_revision')::integer,1);
  event_key := txid_current()::text||':'||TG_ARGV[0]||':'||object_id||':'||object_revision::text;
  PERFORM pg_advisory_xact_lock(hashtextextended('personal-agent-change-order',9));
  INSERT INTO agent_changes(subject_id,event_id,event_type,refs,created_at)
  VALUES(subject,event_key,TG_ARGV[0]||'.changed',jsonb_build_array(jsonb_build_object('kind',TG_ARGV[0],'id',object_id,'revision',object_revision)),clock_timestamp())
  ON CONFLICT(event_id) DO NOTHING;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER journal_meals AFTER INSERT OR UPDATE OR DELETE ON meals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('meal');
CREATE CONSTRAINT TRIGGER journal_purchases AFTER INSERT OR UPDATE OR DELETE ON purchases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('purchase');
CREATE CONSTRAINT TRIGGER journal_money_entries AFTER INSERT OR UPDATE OR DELETE ON money_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('money_entry');
CREATE CONSTRAINT TRIGGER journal_health_measurements AFTER INSERT OR UPDATE OR DELETE ON health_measurements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_measurement');
CREATE CONSTRAINT TRIGGER journal_health_workout_sessions AFTER INSERT OR UPDATE OR DELETE ON health_workout_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_workout');
CREATE CONSTRAINT TRIGGER journal_health_observations AFTER INSERT OR UPDATE OR DELETE ON health_observations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_observation');
CREATE CONSTRAINT TRIGGER journal_health_sleep_sessions AFTER INSERT OR UPDATE OR DELETE ON health_sleep_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_sleep');
CREATE CONSTRAINT TRIGGER journal_health_daily_activity AFTER INSERT OR UPDATE OR DELETE ON health_daily_activity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_activity');
CREATE CONSTRAINT TRIGGER journal_health_habit_logs AFTER INSERT OR UPDATE OR DELETE ON health_habit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_habit');
CREATE CONSTRAINT TRIGGER journal_trips AFTER INSERT OR UPDATE OR DELETE ON trips DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('trip');
CREATE CONSTRAINT TRIGGER journal_library_items AFTER INSERT OR UPDATE OR DELETE ON library_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('library_item');
CREATE CONSTRAINT TRIGGER journal_life_projects AFTER INSERT OR UPDATE OR DELETE ON life_projects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('life_project');
CREATE CONSTRAINT TRIGGER journal_action_items AFTER INSERT OR UPDATE OR DELETE ON action_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('action_item');
CREATE CONSTRAINT TRIGGER journal_meal_plans AFTER INSERT OR UPDATE OR DELETE ON meal_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('meal_plan');
CREATE CONSTRAINT TRIGGER journal_food_stock_lots AFTER INSERT OR UPDATE OR DELETE ON food_stock_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('food_stock_lot');
CREATE CONSTRAINT TRIGGER journal_owned_items AFTER INSERT OR UPDATE OR DELETE ON owned_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('owned_item');
CREATE CONSTRAINT TRIGGER journal_recipes AFTER INSERT OR UPDATE OR DELETE ON recipes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('recipe');
CREATE CONSTRAINT TRIGGER journal_food_references AFTER INSERT OR UPDATE OR DELETE ON food_references DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('food');
CREATE CONSTRAINT TRIGGER journal_places AFTER INSERT OR UPDATE OR DELETE ON places DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('place');
CREATE CONSTRAINT TRIGGER journal_reservations AFTER INSERT OR UPDATE OR DELETE ON reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('reservation');
CREATE CONSTRAINT TRIGGER journal_sources AFTER INSERT OR UPDATE OR DELETE ON sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('source');
CREATE CONSTRAINT TRIGGER journal_agent_intentions AFTER INSERT OR UPDATE OR DELETE ON agent_intentions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('agent_intention');
CREATE CONSTRAINT TRIGGER journal_agent_tasks AFTER INSERT OR UPDATE OR DELETE ON agent_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('agent_task');
CREATE CONSTRAINT TRIGGER journal_agent_learning AFTER INSERT OR UPDATE OR DELETE ON agent_learning DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('agent_learning');
CREATE CONSTRAINT TRIGGER journal_agent_subscriptions AFTER INSERT OR UPDATE OR DELETE ON agent_subscriptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('agent_subscription');
CREATE CONSTRAINT TRIGGER journal_health_source_instances AFTER INSERT OR UPDATE ON health_source_instances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('health_source');
COMMIT;
