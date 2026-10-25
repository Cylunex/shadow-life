BEGIN;

INSERT INTO health_habit_logs(
  id,subject_id,raw_id,raw_version,occurred_on,time_zone,habit_key,done_count,
  explicit_denial,note,effective,revision,created_at
)
SELECT
  workout.id,workout.subject_id,workout.raw_id,workout.raw_version,workout.occurred_on,
  workout.time_zone,'release',1,false,'来自 Samsung Health 自定义记录“起飞”',true,
  workout.revision,workout.created_at
FROM health_workout_sessions workout
WHERE workout.effective AND (
  lower(btrim(workout.session_type)) IN ('release','起飞') OR
  lower(btrim(coalesce(workout.detail->>'custom_title','')))='起飞' OR
  workout.detail->>'excluded_from_activity'='true'
)
ON CONFLICT(raw_id) DO UPDATE SET
  raw_version=excluded.raw_version,
  occurred_on=excluded.occurred_on,
  time_zone=excluded.time_zone,
  habit_key='release',
  done_count=1,
  explicit_denial=false,
  note=excluded.note,
  effective=true,
  revision=health_habit_logs.revision+1;

INSERT INTO health_projection_invalidations(subject_id,occurred_on,projection_key,algorithm_version,valid)
SELECT DISTINCT subject_id,occurred_on,'daily_health','health-normalizer',false
FROM health_workout_sessions
WHERE effective AND (
  lower(btrim(session_type)) IN ('release','起飞') OR
  lower(btrim(coalesce(detail->>'custom_title','')))='起飞' OR
  detail->>'excluded_from_activity'='true'
)
ON CONFLICT(subject_id,occurred_on,projection_key,algorithm_version)
DO UPDATE SET valid=false,updated_at=now();

UPDATE health_workout_sessions
SET effective=false,revision=revision+1
WHERE effective AND (
  lower(btrim(session_type)) IN ('release','起飞') OR
  lower(btrim(coalesce(detail->>'custom_title','')))='起飞' OR
  detail->>'excluded_from_activity'='true'
);

COMMIT;
