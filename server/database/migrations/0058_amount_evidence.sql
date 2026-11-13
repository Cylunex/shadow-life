CREATE TABLE amount_evidence (
  id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id),
  record_id text NOT NULL REFERENCES consumption_records(id), field text NOT NULL CHECK(field IN ('paid','discount','delivery')),
  source_id text NOT NULL REFERENCES sources(id), asset_version_id text REFERENCES asset_versions(id),
  amount numeric(24,6) NOT NULL CHECK(amount>=0), page integer CHECK(page>0), quote text, region jsonb,
  revision integer NOT NULL DEFAULT 1, UNIQUE(record_id,field)
);
