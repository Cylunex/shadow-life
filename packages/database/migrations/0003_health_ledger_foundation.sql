BEGIN;
CREATE TABLE consumption_records (
  id text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES principals(id),
  record_kind text NOT NULL CHECK (record_kind IN ('money_only','consumption')),
  state text NOT NULL CHECK (state IN ('draft','confirmed','voided')),
  occurred_on date NOT NULL,
  occurred_at timestamptz,
  time_zone text NOT NULL,
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  confirmed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='draft' AND confirmed_at IS NULL AND voided_at IS NULL) OR (state='confirmed' AND confirmed_at IS NOT NULL AND voided_at IS NULL) OR (state='voided' AND confirmed_at IS NOT NULL AND voided_at IS NOT NULL)),
  UNIQUE (id, subject_id)
);
CREATE INDEX consumption_records_subject_time_idx ON consumption_records(subject_id, occurred_on DESC, occurred_at DESC, id DESC);
CREATE TABLE consumption_record_revisions (record_id text NOT NULL REFERENCES consumption_records(id), revision integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id, revision));

ALTER TABLE money_entries ADD COLUMN record_id text REFERENCES consumption_records(id);
ALTER TABLE money_entries ADD COLUMN payment_method text;
ALTER TABLE money_entries ADD COLUMN source_scale integer NOT NULL DEFAULT 2 CHECK (source_scale BETWEEN 0 AND 6);
ALTER TABLE money_entries ADD CONSTRAINT money_entries_record_unique UNIQUE(record_id);
ALTER TABLE money_entries ADD CONSTRAINT money_entries_id_subject_unique UNIQUE(id,subject_id);
ALTER TABLE purchases ADD COLUMN record_id text REFERENCES consumption_records(id);
ALTER TABLE purchases ALTER COLUMN merchant DROP NOT NULL;
ALTER TABLE purchases ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE purchases ADD COLUMN scene text;
ALTER TABLE purchases ADD COLUMN channel_name_raw text;
ALTER TABLE purchases ADD COLUMN place_ref text;
ALTER TABLE purchases ADD COLUMN rating integer CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE purchases ADD COLUMN would_repeat boolean;
ALTER TABLE purchase_items RENAME COLUMN name TO raw_name;
ALTER TABLE purchase_items ADD COLUMN unit text;
ALTER TABLE purchase_items ADD COLUMN line_amount numeric(24,6);
ALTER TABLE purchase_items ADD COLUMN category_key text;
ALTER TABLE refunds ALTER COLUMN original_entry_id DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN link_state text NOT NULL DEFAULT 'linked' CHECK (link_state IN ('linked','legacy_unlinked'));

INSERT INTO consumption_records(id,subject_id,record_kind,state,occurred_on,occurred_at,time_zone,note,confirmed_at)
SELECT 'record_purchase_'||md5(id),subject_id,'consumption','confirmed',occurred_on,occurred_at,time_zone,note,now() FROM purchases WHERE record_id IS NULL;
UPDATE purchases SET record_id='record_purchase_'||md5(id) WHERE record_id IS NULL;
ALTER TABLE purchases ALTER COLUMN record_id SET NOT NULL;
ALTER TABLE purchases ADD CONSTRAINT purchases_record_unique UNIQUE(record_id);

INSERT INTO consumption_records(id,subject_id,record_kind,state,occurred_on,occurred_at,time_zone,note,confirmed_at)
SELECT 'record_'||md5(id),subject_id,'money_only','confirmed',occurred_on,occurred_at,time_zone,note,now() FROM money_entries WHERE record_id IS NULL;
UPDATE money_entries SET record_id='record_'||md5(id) WHERE record_id IS NULL;
ALTER TABLE money_entries ALTER COLUMN record_id SET NOT NULL;
ALTER TABLE money_entries ADD CONSTRAINT money_entries_record_subject_fk FOREIGN KEY(record_id,subject_id) REFERENCES consumption_records(id,subject_id);
ALTER TABLE purchases ADD CONSTRAINT purchases_record_subject_fk FOREIGN KEY(record_id,subject_id) REFERENCES consumption_records(id,subject_id);
ALTER TABLE refunds ADD CONSTRAINT refunds_original_subject_fk FOREIGN KEY(original_entry_id,subject_id) REFERENCES money_entries(id,subject_id);
ALTER TABLE refunds ADD CONSTRAINT refunds_refund_subject_fk FOREIGN KEY(refund_entry_id,subject_id) REFERENCES money_entries(id,subject_id);

CREATE TABLE health_source_instances (id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), source_type text NOT NULL, instance_key text NOT NULL, fingerprint text, permission_state text NOT NULL DEFAULT 'granted', sync_epoch integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,source_type,instance_key), UNIQUE(id,subject_id));
CREATE TABLE health_raw_records (id text PRIMARY KEY, subject_id text NOT NULL REFERENCES principals(id), source_instance_id text NOT NULL REFERENCES health_source_instances(id), record_type text NOT NULL, client_record_id text NOT NULL, current_version bigint NOT NULL CHECK(current_version>=0), current_sync_epoch integer NOT NULL CHECK(current_sync_epoch>0), current_hash text NOT NULL, state text NOT NULL CHECK(state IN ('pending','normalized','failed','deleted','quarantined')), pending_reason text, parse_version text, normalization_attempts integer NOT NULL DEFAULT 0, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject_id,source_instance_id,record_type,client_record_id), UNIQUE(id,subject_id));
CREATE TABLE health_raw_revisions (raw_id text NOT NULL REFERENCES health_raw_records(id), record_version bigint NOT NULL, payload_hash text NOT NULL, payload jsonb, change_kind text NOT NULL CHECK(change_kind IN ('upsert','delete')), received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(raw_id,record_version));
CREATE TABLE health_provider_aliases (subject_id text NOT NULL REFERENCES principals(id), source_instance_id text NOT NULL REFERENCES health_source_instances(id), record_type text NOT NULL, provider_record_id text NOT NULL, raw_id text NOT NULL REFERENCES health_raw_records(id), PRIMARY KEY(subject_id,source_instance_id,record_type,provider_record_id));
CREATE TABLE health_sync_cursors (subject_id text NOT NULL REFERENCES principals(id), device_id text NOT NULL, source_instance_id text NOT NULL REFERENCES health_source_instances(id), record_type text NOT NULL, permission_fingerprint text NOT NULL, sync_epoch integer NOT NULL, cursor text, state text NOT NULL CHECK(state IN ('active','expired','revoked','rescan_required')), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject_id,device_id,source_instance_id,record_type));
ALTER TABLE health_measurements ADD COLUMN raw_id text REFERENCES health_raw_records(id);
ALTER TABLE health_measurements ADD COLUMN group_id text;
ALTER TABLE health_measurements ADD COLUMN autofilled boolean NOT NULL DEFAULT false;
ALTER TABLE health_measurements ADD COLUMN effective boolean NOT NULL DEFAULT true;
COMMIT;
