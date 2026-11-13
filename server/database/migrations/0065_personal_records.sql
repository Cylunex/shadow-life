CREATE TABLE storage_containers (
 id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),label text NOT NULL,
 parent_id text REFERENCES storage_containers(id),revision integer NOT NULL DEFAULT 1
);
CREATE INDEX storage_container_parent ON storage_containers(subject_id,parent_id);
ALTER TABLE owned_items ADD COLUMN container_id text REFERENCES storage_containers(id);
CREATE TABLE lab_observations (
 id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),report_id text NOT NULL,report_revision integer NOT NULL,
 page integer NOT NULL CHECK(page>0),tested_on date NOT NULL,raw_name text NOT NULL,value text NOT NULL,unit text,reference text,revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(report_id,report_revision) REFERENCES library_revisions(item_id,revision)
);
CREATE INDEX lab_report ON lab_observations(subject_id,report_id,tested_on,id);
CREATE TABLE symptom_episodes (
 id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),title text NOT NULL,started_on date NOT NULL,time_zone text NOT NULL,
 started_at timestamptz,ended_on date,ended_at timestamptz,points jsonb NOT NULL,note text,revision integer NOT NULL DEFAULT 1
);
CREATE INDEX symptom_episode_days ON symptom_episodes(subject_id,started_on,id);
CREATE TABLE recording_clips (
 id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),segment_id text NOT NULL REFERENCES capture_recording_segments(id),
 title text NOT NULL,start_ms integer NOT NULL,end_ms integer NOT NULL CHECK(end_ms>start_ms),selected boolean NOT NULL,quote text,revision integer NOT NULL DEFAULT 1
);
CREATE INDEX recording_clip_segment ON recording_clips(subject_id,segment_id);
