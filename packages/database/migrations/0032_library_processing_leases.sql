ALTER TABLE library_processing_jobs ADD COLUMN lease_expires_at timestamptz;

-- Old attempts have no renewable ownership proof. Make them immediately reclaimable;
-- preserve their attempts, source identity and any terminal result.
UPDATE library_processing_jobs SET lease_expires_at = clock_timestamp() WHERE state = 'running';
ALTER TABLE library_processing_jobs ADD CONSTRAINT library_processing_lease_state
  CHECK ((state = 'running') = (lease_expires_at IS NOT NULL));
CREATE INDEX library_processing_jobs_expired_idx ON library_processing_jobs(lease_expires_at,id)
  WHERE state = 'running';
