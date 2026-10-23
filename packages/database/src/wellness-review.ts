import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { wellnessDaySchema, wellnessNutrients } from "@shadow/contracts";
import type * as schema from "./schema.js";

// Aggregate inside one SQL statement: a bounded response and one MVCC snapshot,
// even when an import or a correction commits during the read.
export async function readWellnessDays(database:NodePgDatabase<typeof schema>,subjectId:string,from:string,to:string) {
  const nutrientFields=wellnessNutrients.flatMap(key=>[
    sql`${key}::text`,
    sql`jsonb_build_object('known_total',round(sum(${sql.raw(`item.${key}`)} * coalesce(item.consumed_fraction,1)),6)::text,
      'known_items',count(${sql.raw(`item.${key}`)})::int,
      'estimated_items',count(*) filter(where ${sql.raw(`item.${key}`)} is not null and (item.estimate or item.provenance='estimated'))::int)`
  ]);
  const result=await database.execute<{day_value:unknown;as_of:string}>(sql`
    with calendar as (select (${from}::date+n)::date date from generate_series(0,${to}::date-${from}::date) n)
    select jsonb_build_object('date',calendar.date::text,
      'meals',(select count(*)::int from meals where subject_id=${subjectId} and occurred_on=calendar.date),
      'empty_meals',(select count(*)::int from meals meal where meal.subject_id=${subjectId} and meal.occurred_on=calendar.date
        and not exists(select 1 from intake_items item where item.meal_id=meal.id and item.subject_id=${subjectId} and item.effective)),
      'items',nutrition.items,'nutrients',nutrition.nutrients,'sleep',sleep.value,'weight',weight.value,'workouts',workouts.value) as day_value,
      statement_timestamp()::text as_of
    from calendar
    cross join lateral (select count(*)::int items,jsonb_build_object(${sql.join(nutrientFields,sql`,`)}) nutrients
      from intake_items item join meals meal on meal.id=item.meal_id and meal.subject_id=${subjectId}
      where item.subject_id=${subjectId} and item.effective and meal.occurred_on=calendar.date) nutrition
    left join lateral (select jsonb_build_object('id',id,'revision',revision,'minutes',total_minutes) value
      from health_sleep_sessions where subject_id=${subjectId} and effective and wake_date=calendar.date
      order by total_minutes desc,revision desc,id limit 1) sleep on true
    left join lateral (select jsonb_build_object('id',id,'revision',revision,'value',value::text,'unit',unit,'kind',kind) value
      from (select id,revision,value,unit,'measurement' kind,occurred_at,created_at from health_measurements
        where subject_id=${subjectId} and effective and not autofilled and metric='weight' and unit='kg' and occurred_on=calendar.date
        union all select id,revision,value,unit,'observation',occurred_at,created_at from health_observations
        where subject_id=${subjectId} and effective and not autofilled and metric_key='weight' and unit='kg' and occurred_on=calendar.date) weights
      order by coalesce(occurred_at,created_at) desc,id desc limit 1) weight on true
    cross join lateral (select jsonb_build_object('sessions',count(*)::int,'known_duration_sessions',count(duration_minutes)::int,
      'minutes',sum(duration_minutes)::int) value from health_workout_sessions
      where subject_id=${subjectId} and effective and occurred_on=calendar.date) workouts
    order by calendar.date`);
  return {days:result.rows.map(row=>wellnessDaySchema.parse(row.day_value)),as_of:new Date(result.rows[0]!.as_of).toISOString()};
}
