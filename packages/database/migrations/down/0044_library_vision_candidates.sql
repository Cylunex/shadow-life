ALTER TABLE library_processing_jobs DROP CONSTRAINT library_processing_suggestion_object;
ALTER TABLE library_processing_jobs DROP COLUMN suggestion;
ALTER TABLE library_processing_jobs DROP CONSTRAINT library_processing_jobs_kind_check;
ALTER TABLE library_processing_jobs ADD CONSTRAINT library_processing_jobs_kind_check CHECK (kind IN ('text_extract','ocr','transcript'));
