ALTER TABLE activity_captures ADD COLUMN app_category text;
ALTER TABLE activity_captures ADD COLUMN protected boolean NOT NULL DEFAULT false;
ALTER TABLE capture_recording_segments ADD COLUMN protected boolean NOT NULL DEFAULT false;
ALTER TABLE capture_recording_segments ADD COLUMN audio_expired_at timestamptz;
ALTER TABLE capture_recording_segments ADD COLUMN processed_at timestamptz;
CREATE TABLE capture_policies(id text PRIMARY KEY,subject_id text NOT NULL UNIQUE REFERENCES principals(id),revision integer NOT NULL DEFAULT 1,policy jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE capture_classifications(capture_id text PRIMARY KEY REFERENCES activity_captures(id),subject_id text NOT NULL REFERENCES principals(id),revision integer NOT NULL DEFAULT 1,behavior text NOT NULL,life_domain text NOT NULL,project_id text REFERENCES life_projects(id),origin text NOT NULL);
CREATE TABLE capture_classification_history(capture_id text NOT NULL REFERENCES activity_captures(id),revision integer NOT NULL,snapshot jsonb NOT NULL,PRIMARY KEY(capture_id,revision));
CREATE TABLE capture_app_rules(subject_id text NOT NULL REFERENCES principals(id),app_package text NOT NULL,behavior text NOT NULL,life_domain text NOT NULL,project_id text REFERENCES life_projects(id),PRIMARY KEY(subject_id,app_package));
CREATE TABLE capture_goals(id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),intention_id text NOT NULL REFERENCES agent_intentions(id),revision integer NOT NULL DEFAULT 1,behavior text,life_domain text,project_id text REFERENCES life_projects(id),period text NOT NULL,direction text NOT NULL,active boolean NOT NULL);
CREATE INDEX capture_visible_search ON activity_captures(subject_id,started_at,id) WHERE deleted_at IS NULL;
CREATE INDEX capture_classification_subject ON capture_classifications(subject_id,project_id);

CREATE TABLE capture_restore_assets(subject_id text NOT NULL REFERENCES principals(id),archive_id text NOT NULL,source_id text NOT NULL,library_item_id text NOT NULL REFERENCES library_items(id),PRIMARY KEY(subject_id,archive_id,source_id));

CREATE TABLE capture_screenshot_sources(item_id text PRIMARY KEY REFERENCES library_items(id),subject_id text NOT NULL REFERENCES principals(id),app_package text,captured_at timestamptz NOT NULL,time_zone text NOT NULL,deleted_at timestamptz);
CREATE TABLE capture_processing_counters(subject_id text NOT NULL REFERENCES principals(id),on_date date NOT NULL,kind text NOT NULL,count integer NOT NULL DEFAULT 0,PRIMARY KEY(subject_id,on_date,kind));

ALTER TABLE activity_captures ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION touch_capture_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.material_updated_at=clock_timestamp();
 NEW.revision=OLD.revision+1;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER journal_activity_captures AFTER INSERT OR UPDATE OR DELETE ON activity_captures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publish_personal_agent_change('activity_capture');

ALTER TABLE library_processing_jobs ADD COLUMN capture_automatic boolean NOT NULL DEFAULT false;
