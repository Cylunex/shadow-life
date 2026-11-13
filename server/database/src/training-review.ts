import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {saveWorkoutRouteSchema,saveRestDaySchema,type routeComparisonInputSchema,type eveningSleepInputSchema} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
export async function setWorkoutRoute(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveWorkoutRouteSchema.parse(command.input);
  const w=await database.execute(sql`select id from health_workout_sessions where id=${v.workout_id} and subject_id=${subjectId} and effective for update`);
  if(!w.rowCount)throw conflict("运动记录不可用");
  const prior=(await database.execute<{id:string;revision:number}>(sql`select id,revision from workout_route_tags where workout_id=${v.workout_id}`)).rows[0];
  if(prior?.revision!==v.expected_revision)throw conflict("路线标记已更新");
  const id=prior?.id??nextId("route"),revision=(prior?.revision??0)+1;
  await database.execute(sql`insert into workout_route_tags(id,subject_id,workout_id,route,duration_basis,revision)
    values(${id},${subjectId},${v.workout_id},${v.route},${v.duration_basis},${revision}) on conflict(workout_id) do update
    set route=excluded.route,duration_basis=excluded.duration_basis,revision=excluded.revision`);
  return {resources:[{type:"workout_route",id,revision}],actualValues:{route:v.route,workout_id:v.workout_id,revision}};
}
export async function routeComparison(database:Database,subject:string,v:ReturnType<typeof routeComparisonInputSchema.parse>,_effects:ReadonlySet<string>){
  const rows=await database.execute(sql`select w.id,w.session_type,w.occurred_on::text,w.distance_km::text,w.duration_minutes,w.rpe,w.heart_rate_avg,
    t.route,t.duration_basis,t.revision,case when t.duration_basis in ('moving','elapsed') and w.distance_km>0 and w.duration_minutes>0
      then round(w.duration_minutes/w.distance_km,3)::text end minutes_per_km
    from health_workout_sessions w left join workout_route_tags t on t.workout_id=w.id and t.subject_id=w.subject_id
    where w.subject_id=${subject} and w.effective and ${v.workout_id?sql`w.id=${v.workout_id}`:sql`t.route=${v.route}`}
      ${v.session_type?sql`and w.session_type=${v.session_type}`:sql` `} ${v.duration_basis?sql`and t.duration_basis=${v.duration_basis}`:sql` `}
    order by w.occurred_on desc,w.id desc offset ${v.offset} limit ${v.limit+1}`);
  return {items:rows.rows.slice(0,v.limit),next_offset:rows.rows.length>v.limit?v.offset+v.limit:null};
}
export async function setRestDay(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveRestDaySchema.parse(command.input);
  const result=await database.execute<{id:string;revision:number}>(sql`insert into workout_rest_days as d(id,subject_id,occurred_on,time_zone,is_rest)
    select ${nextId("restday")},${subjectId},${v.occurred_on}::date,${v.time_zone},${v.is_rest}
    where ${v.expected_revision??null}::int is null or exists(select 1 from workout_rest_days
      where subject_id=${subjectId} and occurred_on=${v.occurred_on}::date and time_zone=${v.time_zone})
    on conflict(subject_id,occurred_on,time_zone) do update set is_rest=excluded.is_rest,revision=d.revision+1
    where d.revision=${v.expected_revision??null} returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("休息标记已更新");
  return {resources:[{type:"workout_rest_day",...row}],actualValues:{occurred_on:v.occurred_on,revision:row.revision,is_rest:v.is_rest}};
}
export async function eveningSleep(database:Database,subject:string,v:ReturnType<typeof eveningSleepInputSchema.parse>,_effects:ReadonlySet<string>){
  type Day={date:string;wake_date:string;rest_revision:number|null;is_rest:boolean;group:"evening"|"rest"|"other"|"unknown";sleep_id:string|null;sleep_minutes:number|null;workouts:Array<{id:string;started_at:string|null}>};
  const result=await database.execute<Day>(sql`with calendar as (
    select ${v.from}::date+n local_day from generate_series(0,${v.to}::date-${v.from}::date)n
  ) select d.local_day::text date,(d.local_day+1)::text wake_date,rest.revision rest_revision,coalesce(rest.is_rest,false) is_rest,
    case when w.evening then 'evening' when w.n>0 and w.unknown then 'unknown' when w.n>0 then 'other' when rest.is_rest then 'rest' else 'unknown' end "group",
    s.id sleep_id,s.total_minutes sleep_minutes,w.items workouts
    from calendar d left join workout_rest_days rest on rest.subject_id=${subject} and rest.time_zone=${v.time_zone} and rest.occurred_on=d.local_day
    left join lateral(select id,total_minutes,started_at from health_sleep_sessions where subject_id=${subject}
      and effective and wake_date=d.local_day+1 and time_zone=${v.time_zone} order by total_minutes desc,revision desc,id limit 1)s on true
    cross join lateral(select count(*) n,bool_or(w.started_at is null) unknown,
      bool_or((w.started_at at time zone ${v.time_zone})::time>=time '18:00' and (s.started_at is null or w.started_at<s.started_at)) evening,
      coalesce(jsonb_agg(jsonb_build_object('id',w.id,'started_at',w.started_at) order by w.started_at,w.id),'[]'::jsonb) items
      from health_workout_sessions w where w.subject_id=${subject} and w.effective and ((w.started_at at time zone ${v.time_zone})::date=d.local_day
      or (w.started_at is null and w.occurred_on=d.local_day and w.time_zone=${v.time_zone}))) w order by d.local_day`);
  function summary(group:"rest"|"evening"){
    const rows=result.rows.filter(r=>r.group===group),samples=rows.flatMap(r=>r.sleep_minutes===null?[]:[r.sleep_minutes]);
    return {days:rows.length,samples:samples.length,missing:rows.length-samples.length,average_minutes:samples.length?Math.round(samples.reduce((a,b)=>a+b,0)/samples.length):null};
  }
  return {time_zone:v.time_zone,evening_starts:"18:00",days:result.rows,evening:summary("evening"),rest:summary("rest")};
}
