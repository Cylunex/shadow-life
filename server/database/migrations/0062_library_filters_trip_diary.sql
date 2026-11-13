CREATE TABLE library_saved_filters (
  id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),name text NOT NULL,query text NOT NULL,
  archived boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1
);
CREATE INDEX library_saved_filters_owner ON library_saved_filters(subject_id,id);
CREATE TABLE trip_diary_entries (
  id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),trip_id text NOT NULL REFERENCES trips(id),
  local_day date NOT NULL,position integer NOT NULL,body text NOT NULL,refs jsonb NOT NULL,revision integer NOT NULL DEFAULT 1
);
CREATE INDEX trip_diary_day ON trip_diary_entries(subject_id,trip_id,local_day,position,id);
