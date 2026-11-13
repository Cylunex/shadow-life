import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {labResultInputSchema,saveEpisodeSchema,type labCompareInputSchema,type episodesInputSchema} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function saveLabResult(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=labResultInputSchema.parse(command.input),id=v.id??nextId("labobs");
  const report=await db.execute(sql`select l.id from library_items l join library_revisions r on r.item_id=l.id and r.revision=${v.report_revision}
    where l.id=${v.report_id} and l.subject_id=${subjectId} and not exists(select 1 from capture_screenshot_sources cs where cs.item_id=l.id and cs.deleted_at is not null)`);
  if(!report.rowCount)throw conflict("原报告或版本不可用");
  const result=v.id?await db.execute<{revision:number}>(sql`update lab_observations set report_id=${v.report_id},report_revision=${v.report_revision},page=${v.page},tested_on=${v.tested_on},
    raw_name=${v.raw_name},value=${v.value},unit=${v.unit??null},reference=${v.reference??null},revision=revision+1
    where id=${id} and subject_id=${subjectId} and revision=${v.expected_revision} returning revision`):
    await db.execute<{revision:number}>(sql`insert into lab_observations(id,subject_id,report_id,report_revision,page,tested_on,raw_name,value,unit,reference)
    values(${id},${subjectId},${v.report_id},${v.report_revision},${v.page},${v.tested_on},${v.raw_name},${v.value},${v.unit??null},${v.reference??null}) returning revision`);
  const row=result.rows[0];if(!row)throw conflict("检验结果已变更");
  return {resources:[{type:"lab_observation",id,...row}],actualValues:{id,...row}};
}
export async function labResults(db:Database,subject:string,v:ReturnType<typeof labCompareInputSchema.parse>,_effects:ReadonlySet<string>){
  const result=await db.execute(sql`select o.id,o.revision,o.report_id,o.report_revision,l.title report_title,o.page,o.tested_on::text,o.raw_name,o.value,o.unit,o.reference
    from lab_observations o join library_items l on l.id=o.report_id and l.subject_id=o.subject_id where o.subject_id=${subject}
      and not exists(select 1 from capture_screenshot_sources cs where cs.item_id=l.id and cs.deleted_at is not null)
      ${v.report_id?sql`and o.report_id=${v.report_id}`:sql` `} ${v.left_id?sql`and o.id in (${v.left_id},${v.right_id})`:sql` `}
      order by o.tested_on desc,o.id offset ${v.offset} limit ${v.limit+1}`);
  return {items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}
export async function saveEpisode(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveEpisodeSchema.parse(command.input),id=v.id??nextId("episode"),points=JSON.stringify(v.points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)));
  const result=v.id?await db.execute<{revision:number}>(sql`update symptom_episodes set title=${v.title},started_on=${v.started_on},time_zone=${v.time_zone},
    started_at=${v.started_at??null},ended_on=${v.ended_on??null},ended_at=${v.ended_at??null},points=${points}::jsonb,note=${v.note??null},revision=revision+1
    where id=${id} and subject_id=${subjectId} and revision=${v.expected_revision} returning revision`):
    await db.execute<{revision:number}>(sql`insert into symptom_episodes(id,subject_id,title,started_on,time_zone,started_at,ended_on,ended_at,points,note)
    values(${id},${subjectId},${v.title},${v.started_on},${v.time_zone},${v.started_at??null},${v.ended_on??null},${v.ended_at??null},${points}::jsonb,${v.note??null}) returning revision`);
  const row=result.rows[0];if(!row)throw conflict("发作记录已变更");
  return {resources:[{type:"symptom_episode",id,...row}],actualValues:{id,...row}};
}
export async function episodes(db:Database,subject:string,v:ReturnType<typeof episodesInputSchema.parse>,_effects:ReadonlySet<string>){
  const result=await db.execute(sql`select id,revision,title,started_on::text,time_zone,to_jsonb(started_at) started_at,ended_on::text,to_jsonb(ended_at) ended_at,
    points,note,extract(epoch from ended_at-started_at)::float8/60 duration_minutes from symptom_episodes where subject_id=${subject}
    ${v.from?sql`and (ended_on is null or ended_on>=${v.from}::date)`:sql` `} ${v.to?sql`and started_on<=${v.to}::date`:sql` `} ${v.id?sql`and id=${v.id}`:sql` `}
    order by started_on desc,id offset ${v.offset} limit ${v.limit+1}`);
  return {items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}
