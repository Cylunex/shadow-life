CREATE TABLE activity_captures (
 id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), device_id text NOT NULL,
 source_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('app_usage','manual','screen_text')),
 started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, time_zone text NOT NULL,
 title text NOT NULL, app_package text, text text, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(subject_id,device_id,source_id), CHECK((kind='screen_text' AND ended_at=started_at) OR (kind<>'screen_text' AND ended_at>started_at AND ended_at-started_at<=interval '24 hours'))
);
CREATE INDEX activity_captures_subject_time ON activity_captures(subject_id,started_at,id);
