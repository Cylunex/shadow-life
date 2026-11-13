import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {saveClipSchema,saveOfflineIntervalSchema,type clipsInputSchema,type offlineDayInputSchema} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function saveClip(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveClipSchema.parse(command.input),id=v.id??nextId("clip");
  const segment=(await db.execute<{quote:string|null}>(sql`select (select string_agg(span->>'text',' ' order by ord)
    from jsonb_array_elements(s.spans) with ordinality as a(span,ord) where (span->>'start_ms')::int<${v.end_ms} and (span->>'end_ms')::int>${v.start_ms}) quote
    from capture_recording_segments s where s.id=${v.segment_id} and s.subject_id=${subjectId} and s.deleted_at is null and s.audio_expired_at is null and extract(epoch from ended_at-started_at)*1000>=${v.end_ms} for share`)).rows[0];
  if(!segment)throw conflict("录音不可用或片段超出原声");
  const result=v.id?await db.execute<{revision:number}>(sql`update recording_clips set title=${v.title},start_ms=${v.start_ms},end_ms=${v.end_ms},selected=${v.selected},
    quote=case when start_ms=${v.start_ms} and end_ms=${v.end_ms} then quote else ${segment.quote} end,revision=revision+1
    where id=${id} and subject_id=${subjectId} and segment_id=${v.segment_id} and revision=${v.expected_revision} returning revision`):
    await db.execute<{revision:number}>(sql`insert into recording_clips(id,subject_id,segment_id,title,start_ms,end_ms,selected,quote)
      values(${id},${subjectId},${v.segment_id},${v.title},${v.start_ms},${v.end_ms},${v.selected},${segment.quote}) returning revision`);
  const row=result.rows[0];if(!row)throw conflict("精选片段已变更");
  return {resources:[{type:"recording_clip",id,...row}],actualValues:{id,...row}};
}
export async function clips(db:Database,subject:string,v:ReturnType<typeof clipsInputSchema.parse>,effects:ReadonlySet<string>){
  const result=await db.execute(sql`select c.id,c.revision,c.segment_id,c.title,d.local_day::text,c.start_ms,c.end_ms,c.selected,c.quote,
    case when s.deleted_at is null and s.audio_expired_at is null and ${effects.has("library.asset.read")} then s.asset_version_id end asset_version_id
    from recording_clips c join capture_recording_segments s on s.id=c.segment_id and s.subject_id=c.subject_id
    cross join lateral(select ((s.started_at+c.start_ms*interval '1 millisecond') at time zone ${v.time_zone})::date local_day) d
    where c.subject_id=${subject} and d.local_day between ${v.from}::date and ${v.to}::date and (${v.selected}='all' or c.selected)
    order by s.started_at,c.start_ms,c.id offset ${v.offset} limit ${v.limit+1}`);
  return {items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}

export async function saveOfflineInterval(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveOfflineIntervalSchema.parse(command.input),id=v.id??nextId("activity");
  const result=v.id?await db.execute<{revision:number}>(sql`update activity_captures set title=${v.title},started_at=${v.started_at},ended_at=${v.ended_at},time_zone=${v.time_zone},
    revision=revision+1,material_updated_at=now() where id=${id} and subject_id=${subjectId} and kind='manual' and device_id='life.personal.timeline'
    and source_id=id and deleted_at is null and revision=${v.expected_revision} returning revision`):
    await db.execute<{revision:number}>(sql`insert into activity_captures(id,subject_id,device_id,source_id,kind,started_at,ended_at,time_zone,title,fingerprint)
      values(${id},${subjectId},'life.personal.timeline',${id},'manual',${v.started_at},${v.ended_at},${v.time_zone},${v.title},${command.command_id}) returning revision`);
  const row=result.rows[0];if(!row)throw conflict("手工区间已更新或不可更正");
  return {resources:[{type:"activity_capture",id,...row}],actualValues:{id,...row}};
}
export async function offlineDay(db:Database,subject:string,v:ReturnType<typeof offlineDayInputSchema.parse>,_effects:ReadonlySet<string>){
  const selected=sql`with bounds as (select ${v.date}::date::timestamp at time zone ${v.time_zone} a,(${v.date}::date+1)::timestamp at time zone ${v.time_zone} b),
    selected as (select c.*,greatest(c.started_at,bounds.a) lo,least(c.ended_at,bounds.b) hi from activity_captures c,bounds
      where c.subject_id=${subject} and c.deleted_at is null and c.started_at<bounds.b and c.ended_at>bounds.a and c.ended_at>c.started_at)`;
  const totals=await db.execute<{minutes:number}>(sql`${selected} select coalesce(sum(extract(epoch from upper(r)-lower(r)))/60,0)::float8 minutes
    from unnest((select range_agg(tstzrange(lo,hi,'[)')) from selected)) r`);
  const result=await db.execute(sql`${selected} select id,revision,title,kind,(kind='manual' and device_id='life.personal.timeline' and source_id=id) editable,
    to_jsonb(started_at) started_at,to_jsonb(ended_at) ended_at from selected order by started_at,id offset ${v.offset} limit ${v.limit+1}`);
  return {active_minutes:totals.rows[0]!.minutes,coverage:"unknown_outside_observations",items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}
