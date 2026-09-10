ALTER TABLE runs ADD COLUMN owner_id text;
ALTER TABLE runs ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE runs ADD COLUMN stop_requested_at timestamptz;
CREATE INDEX runs_active_lease_idx ON runs(thread_id,lease_expires_at) WHERE status='running';
ALTER TABLE operations ADD COLUMN agent_run_id text REFERENCES runs(id);
ALTER TABLE operations ADD COLUMN agent_tool_call_id text;
ALTER TABLE operations ADD CONSTRAINT operations_agent_binding CHECK ((agent_run_id IS NULL)=(agent_tool_call_id IS NULL));
CREATE INDEX operations_agent_run_idx ON operations(agent_run_id) WHERE agent_run_id IS NOT NULL;
