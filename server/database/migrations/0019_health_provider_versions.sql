-- Health Connect last-modified versions are millisecond epochs and exceed int32.
ALTER TABLE health_normalization_queue
  ALTER COLUMN raw_version TYPE bigint;
