ALTER TABLE library_revisions ADD COLUMN document_date date;
ALTER TABLE library_revisions ADD COLUMN category text;
ALTER TABLE library_revisions ADD COLUMN source_processing_job_id text REFERENCES library_processing_jobs(id);
