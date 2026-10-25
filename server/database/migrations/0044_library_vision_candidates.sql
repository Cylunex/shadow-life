ALTER TABLE library_processing_jobs DROP CONSTRAINT library_processing_jobs_kind_check;
ALTER TABLE library_processing_jobs ADD CONSTRAINT library_processing_jobs_kind_check CHECK (kind IN ('text_extract','ocr','transcript','vision'));
ALTER TABLE library_processing_jobs ADD COLUMN suggestion jsonb;
ALTER TABLE library_processing_jobs ADD CONSTRAINT library_processing_suggestion_object CHECK (suggestion IS NULL OR jsonb_typeof(suggestion)='object');
