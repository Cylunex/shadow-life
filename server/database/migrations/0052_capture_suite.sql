ALTER TABLE activity_captures DROP CONSTRAINT activity_captures_kind_check;
ALTER TABLE activity_captures ADD CONSTRAINT activity_captures_kind_check CHECK(kind IN ('app_usage','manual','screen_text','stay','recording'));
ALTER TABLE activity_captures ADD COLUMN latitude double precision;
ALTER TABLE activity_captures ADD COLUMN longitude double precision;
ALTER TABLE activity_captures ADD COLUMN accuracy_m double precision;
CREATE TABLE capture_recording_segments (
 id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), session_id text NOT NULL,
 segment_index integer NOT NULL, title text NOT NULL,started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,time_zone text NOT NULL,
 asset_version_id text NOT NULL REFERENCES asset_versions(id),fingerprint text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed')),
 attempt integer NOT NULL DEFAULT 0,lease_expires_at timestamptz,revision integer NOT NULL DEFAULT 1,
 spans jsonb NOT NULL DEFAULT '[]',processor_version text,error text,deleted_at timestamptz,
 UNIQUE(subject_id,session_id,segment_index), CHECK(ended_at>started_at AND ended_at-started_at<=interval '5 minutes')
);
CREATE INDEX capture_recordings_pending ON capture_recording_segments(state,lease_expires_at) WHERE deleted_at IS NULL;
CREATE TABLE capture_transcript_revisions(segment_id text NOT NULL REFERENCES capture_recording_segments(id),revision integer NOT NULL,spans jsonb NOT NULL,reason text NOT NULL,PRIMARY KEY(segment_id,revision));
CREATE TABLE capture_order_rules(id text NOT NULL UNIQUE,revision integer NOT NULL DEFAULT 1,subject_id text NOT NULL REFERENCES principals(id),app_package text NOT NULL,platform text NOT NULL,source_account text NOT NULL,enabled boolean NOT NULL,auto_accounting boolean NOT NULL,PRIMARY KEY(subject_id,app_package));
CREATE TABLE capture_orders(id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),platform text NOT NULL,source_account text NOT NULL,external_id text NOT NULL,identity_kind text NOT NULL,fields jsonb NOT NULL,status text NOT NULL,conflict boolean NOT NULL DEFAULT false,record_id text,UNIQUE(subject_id,platform,source_account,external_id,identity_kind));
CREATE TABLE capture_order_sources(order_id text NOT NULL REFERENCES capture_orders(id),capture_id text NOT NULL REFERENCES activity_captures(id),fields jsonb NOT NULL,PRIMARY KEY(order_id,capture_id));
CREATE TABLE capture_reviews(id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),period text NOT NULL,from_on date NOT NULL,to_on_exclusive date NOT NULL,time_zone text NOT NULL,revision integer NOT NULL DEFAULT 1,signature text NOT NULL,body text NOT NULL,source_refs jsonb NOT NULL DEFAULT '[]',source_count integer NOT NULL,generated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(subject_id,period,from_on,time_zone));
CREATE TABLE capture_review_revisions(review_id text NOT NULL REFERENCES capture_reviews(id),revision integer NOT NULL,body text NOT NULL,signature text NOT NULL,PRIMARY KEY(review_id,revision));

ALTER TABLE activity_captures ADD COLUMN material_updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION touch_capture_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.material_updated_at=clock_timestamp();
 RETURN NEW;
END;
$$;
CREATE TRIGGER capture_material_changed BEFORE UPDATE ON activity_captures FOR EACH ROW EXECUTE FUNCTION touch_capture_material();
