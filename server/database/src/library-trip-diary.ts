import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {savedFilterSchema,tripDiaryEntrySchema,type savedFiltersInputSchema,type tripDiaryInputSchema} from "@shadow/contracts";
import {conflict,permissionDenied,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
export async function saveLibraryFilter(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=savedFilterSchema.parse(command.input);
  const result=v.id?await db.execute<{id:string;revision:number}>(sql`update library_saved_filters set name=${v.name},query=${v.query},archived=${v.archived},revision=revision+1
    where id=${v.id} and subject_id=${subjectId} and revision=${v.expected_revision} returning id,revision`):
    await db.execute<{id:string;revision:number}>(sql`insert into library_saved_filters(id,subject_id,name,query,archived)
      values(${nextId("filter")},${subjectId},${v.name},${v.query},${v.archived}) returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("保存的筛选已变更");
  return {resources:[{type:"library_saved_filter",...row}],actualValues:{filter_id:row.id,revision:row.revision}};
}
export async function librarySavedFilters(db:Database,subject:string,v:ReturnType<typeof savedFiltersInputSchema.parse>,_effects:ReadonlySet<string>){
  const r=await db.execute<{id:string}>(sql`select id,name,query,revision from library_saved_filters where subject_id=${subject} and not archived
    ${v.id?sql`and id=${v.id}`:sql` `} ${v.after?sql`and id>${v.after}`:sql` `} order by id limit ${v.limit+1}`);
  const items=r.rows.slice(0,v.limit);return {items,next:r.rows.length>v.limit?items.at(-1)!.id:null};
}
type Ref=ReturnType<typeof tripDiaryEntrySchema.parse>["refs"][number];
async function diaryRefs(db:Database,subject:string,trip:string,date:string,refs:Ref[],effects:ReadonlySet<string>){
  const ids=(kind:Ref["kind"])=>refs.filter(r=>r.kind===kind).map(r=>r.id);
  const present=new Map<string,{kind:Ref["kind"];id:string;title:string;asset_version_id:string|null}>();
  const visits=ids("visit");
  if(visits.length){
    const r=await db.execute<{id:string;place_name:string}>(sql`select v.id,v.place_name from visits v join trips t on t.id=v.trip_id
      where v.trip_id=${trip} and (v.subject_id=${subject} or v.visibility='shared') and coalesce((v.occurred_at at time zone t.time_zone)::date,v.occurred_on)=${date}::date
      and v.id in (${sql.join(visits.map(id=>sql`${id}`),sql`,`)})`);
    for(const v of r.rows)present.set("visit:"+v.id,{kind:"visit",id:v.id,title:v.place_name,asset_version_id:null});
  }
  if(effects.has("library.item.read")){
    for(const k of ["photo","audio"] as const){
      const list=ids(k);if(!list.length)continue;
      const entries=k==="photo"?await db.execute<{id:string;title:string;asset_version_id:string}>(sql`
        select l.id,l.title,s.asset_version_id from library_items l join sources s on s.id=l.source_id and s.subject_id=l.subject_id
        join asset_versions v on v.id=s.asset_version_id join assets a on a.id=v.asset_id and a.media_type like 'image/%'
        where l.subject_id=${subject} and l.id in (${sql.join(list.map(id=>sql`${id}`),sql`,`)})
        and not exists(select 1 from capture_screenshot_sources cs where cs.item_id=l.id and cs.deleted_at is not null)`):
        await db.execute<{id:string;title:string;asset_version_id:string}>(sql`select id,title,asset_version_id from capture_recording_segments
          where subject_id=${subject} and deleted_at is null and audio_expired_at is null and id in (${sql.join(list.map(id=>sql`${id}`),sql`,`)})`);
      for(const r of entries.rows)present.set(k+":"+r.id,{kind:k,id:r.id,title:r.title,asset_version_id:effects.has("library.asset.read")?r.asset_version_id:null});
    }
  }
  return refs.flatMap(r=>{const visible=present.get(r.kind+":"+r.id);return visible?[visible]:[];});
}
export async function saveDiaryEntry(db:Database,{subjectId,command,nextId,context}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=tripDiaryEntrySchema.parse(command.input);
  if(v.refs.some(r=>r.kind!=="visit")&&!context?.effects.has("library.item.read"))throw permissionDenied("library.item.read");
  const allowed=await db.execute(sql`select t.id from trips t where t.id=${v.trip_id} and ${v.local_day}::date between t.starts_on and t.ends_on
    and (t.subject_id=${subjectId} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subjectId})) for share`);
  if(!allowed.rowCount)throw conflict("旅程或日期不可用");
  const visible=await diaryRefs(db,subjectId,v.trip_id,v.local_day,v.refs,context?.effects??new Set());
  if(visible.length!==v.refs.length)throw conflict("有材料或当天实际到访已不可用");
  const result=v.id?await db.execute<{id:string;revision:number}>(sql`update trip_diary_entries set local_day=${v.local_day}::date,position=${v.position},body=${v.body},refs=${JSON.stringify(v.refs)}::jsonb,revision=revision+1
    where id=${v.id} and subject_id=${subjectId} and trip_id=${v.trip_id} and revision=${v.expected_revision} returning id,revision`):
    await db.execute<{id:string;revision:number}>(sql`insert into trip_diary_entries(id,subject_id,trip_id,local_day,position,body,refs)
      values(${nextId("diary")},${subjectId},${v.trip_id},${v.local_day},${v.position},${v.body},${JSON.stringify(v.refs)}::jsonb) returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("旅行小记已变更");
  return {resources:[{type:"trip_diary_entry",...row}],actualValues:{entry_id:row.id,revision:row.revision}};
}
export async function tripDiary(db:Database,subject:string,v:ReturnType<typeof tripDiaryInputSchema.parse>,effects:ReadonlySet<string>){
  const rows=await db.execute<{refs:Ref[];local_day:string}>(sql`select d.id,d.local_day::text,d.position,d.body,d.refs,d.revision from trip_diary_entries d
    join trips t on t.id=d.trip_id where d.subject_id=${subject} and t.id=${v.trip_id} and
    (t.subject_id=${subject} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subject}))
    ${v.on?sql`and d.local_day=${v.on}::date`:sql` `} order by d.local_day,d.position,d.id limit ${v.limit+1} offset ${v.offset}`);
  const items=[];for(const r of rows.rows.slice(0,v.limit))items.push({...r,refs:await diaryRefs(db,subject,v.trip_id,r.local_day,r.refs,effects)});
  return {items,next_offset:rows.rows.length>v.limit?v.offset+v.limit:null};
}
