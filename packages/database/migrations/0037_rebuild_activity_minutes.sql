BEGIN;

INSERT INTO health_projection_invalidations(subject_id,occurred_on,projection_key,algorithm_version,valid)
SELECT subject_id,occurred_on,'daily_health','health-normalizer',false
FROM (
  SELECT DISTINCT subject_id,occurred_on FROM health_daily_activity WHERE effective
  UNION
  SELECT DISTINCT subject_id,occurred_on FROM health_workout_sessions WHERE effective
) affected
ON CONFLICT(subject_id,occurred_on,projection_key,algorithm_version)
DO UPDATE SET valid=false,updated_at=now();

COMMIT;
