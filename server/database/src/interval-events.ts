import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { intervalEventSchema, intervalOccurrenceSchema, type IntervalQuery } from "@shadow/contracts";
import { conflict, type TransactionStore } from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
export async function saveIntervalEvent(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const input=intervalEventSchema.parse(command.input);
  const result=input.event_id
    ? await database.execute<{id:string;revision:number}>(sql`update interval_events set name=${input.name},archived=${input.archived},revision=revision+1
        where id=${input.event_id} and subject_id=${subjectId} and revision=${input.expected_revision} returning id,revision`)
    : await database.execute<{id:string;revision:number}>(sql`insert into interval_events(id,subject_id,name,archived)
        values(${nextId("interval")},${subjectId},${input.name},${input.archived}) returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("事项已更新，请重新读取");
  return {resources:[{type:"interval_event",...row}],actualValues:{event_id:row.id,revision:row.revision}};
}
export async function saveIntervalOccurrence(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=intervalOccurrenceSchema.parse(command.input);
  const parent=await database.execute(sql`select id from interval_events where subject_id=${subjectId} and id=${v.event_id}
    and (not archived or ${Boolean(v.occurrence_id)}) for update`);
  if(!parent.rowCount)throw conflict("事项不可用");
  if(v.source_kind){
    const source=v.source_kind==="service_card_use"
      ?await database.execute(sql`select id from service_card_uses where subject_id=${subjectId} and id=${v.source_id} and state='active' for share`)
      :await database.execute(sql`select id from owned_item_events where subject_id=${subjectId} and id=${v.source_id} for share`);
    if(!source.rowCount)throw conflict("来源不可用");
  }
  const result=v.occurrence_id?await database.execute<{id:string;revision:number}>(sql`
    update interval_occurrences set occurred_on=${v.occurred_on??null},occurred_at=${v.occurred_at??null},time_zone=${v.time_zone},
      note=${v.note??null},voided=${v.voided},revision=revision+1 where id=${v.occurrence_id} and event_id=${v.event_id}
      and subject_id=${subjectId} and source_kind is not distinct from ${v.source_kind??null} and source_id is not distinct from ${v.source_id??null}
      and revision=${v.expected_revision} returning id,revision`):
    await database.execute<{id:string;revision:number}>(sql`
      insert into interval_occurrences(id,event_id,subject_id,occurred_on,occurred_at,time_zone,note,source_kind,source_id)
      values(${nextId("occurrence")},${v.event_id},${subjectId},${v.occurred_on??null},${v.occurred_at??null},${v.time_zone},${v.note??null},${v.source_kind??null},${v.source_id??null})
      on conflict(event_id,source_kind,source_id) do nothing returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("记录或来源关联已存在或已更新，请重新读取");
  return {resources:[{type:"interval_occurrence",...row}],actualValues:{event_id:v.event_id,occurrence_id:row.id,revision:row.revision}};
}

export async function readIntervals(database:Database,subjectId:string,v:IntervalQuery,canReadCards:boolean,canReadItems:boolean){
  const defs=await database.execute<{id:string}>(sql`select id,name,archived,revision from interval_events where subject_id=${subjectId}
    ${v.event_id?sql`and id=${v.event_id}`:sql` `} ${v.after_id?sql`and id>${v.after_id}`:sql` `}
    order by id limit ${v.limit+1}`);
  const events=defs.rows.slice(0,v.limit);
  if(!events.length)return {events:[],next:null};
  const details=await database.execute<{event_id:string;id:string;total:number}>(sql`
    with visible as (
      select o.id,o.event_id,o.note,o.source_kind,o.source_id,o.revision,
        coalesce(o.occurred_on,u.occurred_on,i.occurred_on) effective_on,coalesce(c.time_zone,o.time_zone) time_zone,
        to_char(o.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at
      from interval_occurrences o
      left join service_card_uses u on ${canReadCards} and o.source_kind='service_card_use' and u.id=o.source_id and u.subject_id=o.subject_id and u.state='active'
      left join service_cards c on c.id=u.card_id
      left join owned_item_events i on ${canReadItems} and o.source_kind='owned_item_event' and i.id=o.source_id and i.subject_id=o.subject_id
      where o.subject_id=${subjectId} and o.event_id in (${sql.join(events.map(e=>sql`${e.id}`),sql`,`)}) and not o.voided
    ), ranked as (
      select *,effective_on-lag(effective_on) over(partition by event_id order by effective_on,id) interval_days,
        row_number() over(partition by event_id order by effective_on desc,id desc) seq,count(*) over(partition by event_id)::int total
      from visible where effective_on<=${v.as_of}::date
    ) select id,event_id,note,revision,source_kind,source_id,occurred_at,time_zone,effective_on::text occurred_on,
      interval_days,${v.as_of}::date-effective_on days_ago,total from ranked
      where seq>${v.offset} and seq<=${v.offset+v.history_limit} order by event_id,seq`);
  return {events:events.map(e=>{const found=details.rows.filter(r=>r.event_id===e.id);
    return {...e,history:found.map(({event_id,total,...r})=>r),more_history:(found[0]?.total??0)>v.offset+found.length};
  }),next:defs.rows.length>events.length?events.at(-1)!.id:null};
}
