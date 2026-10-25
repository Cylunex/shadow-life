import { mealCountAggregate } from '@shadow/kernel';
import { moneyTitle } from './money-title.js';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';
import type { AgentContextReadOptions, AgentContextReadData } from '@shadow/kernel';
import { agentRefsAvailable } from './agent-refs.js';

const textArray=(values:readonly string[])=>sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

type Database=Pick<NodePgDatabase<typeof schema>,'execute'>;
export async function readAgentContext(database:Database, subjectId:string, options:AgentContextReadOptions):Promise<AgentContextReadData>{
  const {input,kinds}=options, include=(kind:string)=>kinds.includes(kind as typeof kinds[number]);
  const refs=sql`${JSON.stringify(input.object_refs)}::jsonb`, query=input.query?.toLowerCase()??'';
  // One statement = one MVCC snapshot for validity, projections, counts, memories and as_of.
  const result=await database.execute<Record<string,unknown>&AgentContextReadData>(sql`
    with facts as materialized (
      select 'meal'::text kind,m.id,m.revision,'meals'::text domain,
        left(coalesce(nullif((select string_agg(i.name,'、' order by i.position) from intake_items i where i.meal_id=m.id and i.effective),''),m.note,m.meal_type),150) title,
        m.occurred_on business_on,m.occurred_at,m.time_zone,
        coalesce((select s.kind from meal_source_links ms join sources s on s.id=ms.source_id where ms.meal_id=m.id order by s.id limit 1),'manual') source_type,
        null::text amount,null::text currency,m.id detail_id,
        coalesce(m.note,'')||' '||m.meal_type||' '||coalesce((select string_agg(i.name||' '||coalesce(i.free_text,''),' ') from intake_items i where i.meal_id=m.id and i.effective),'') searchable,
        left(coalesce(m.note,''),1000) excerpt,jsonb_build_object('meal_type',m.meal_type,'nutrition','read_detail_for_recorded_values') facts
        from meals m where ${include('meal')} and m.subject_id=${subjectId} and m.state='active'
      union all
      select 'purchase',p.id,p.revision,'meals',left(coalesce(p.merchant,p.note,'购买记录'),150),p.occurred_on,p.occurred_at,p.time_zone,
        coalesce(s.kind,'manual'),case when ${options.includeMoney} then p.amount::text end,case when ${options.includeMoney} then p.currency end,p.record_id,
        coalesce(p.merchant,'')||' '||coalesce(p.note,'')||' '||coalesce((select string_agg(i.raw_name,' ') from purchase_items i where i.purchase_id=p.id),''),left(coalesce(p.note,''),1000),jsonb_build_object('scene',p.scene,'intake','not_proven_by_purchase')
        from purchases p join consumption_records r on r.id=p.record_id left join sources s on s.id=p.source_id where ${include('purchase')} and p.subject_id=${subjectId} and r.state='confirmed'
      union all
      select 'money_entry',entry.id,entry.revision,'money',left(${moneyTitle(include('purchase'))},150),entry.occurred_on,entry.occurred_at,entry.time_zone,coalesce(s.kind,'manual'),entry.amount::text,entry.currency,entry.record_id,
        ${moneyTitle(include('purchase'))}||' '||coalesce(entry.counterparty,'')||' '||coalesce(entry.note,'')||' '||coalesce(entry.category,'')||' '||entry.entry_type,left(coalesce(entry.note,''),1000),jsonb_build_object('entry_type',entry.entry_type,'payment_method',entry.payment_method,'source_scale',entry.source_scale)
        from money_entries entry join consumption_records r on r.id=entry.record_id left join sources s on s.id=entry.source_id where ${include('money_entry')} and entry.subject_id=${subjectId} and r.state='confirmed'
      union all
      select 'health_measurement',h.id,h.revision,'health',left(coalesce(h.label,h.metric),150),h.occurred_on,h.occurred_at,h.time_zone,coalesce(s.kind,'manual'),null,null,h.id,
        coalesce(h.label,'')||' '||h.metric||' '||coalesce(h.note,''),left(coalesce(h.note,''),1000),jsonb_build_object('metric',h.metric,'value',h.value::text,'unit',h.unit)
        from health_measurements h left join sources s on s.id=h.source_id where ${include('health_measurement')} and h.subject_id=${subjectId} and h.effective
      union all
      select 'health_workout',h.id,h.revision,'health',left(h.session_type,150),h.occurred_on,h.started_at,h.time_zone,case when h.raw_id is null then 'manual' else 'device' end,null,null,h.id,
        h.session_type||' '||coalesce(h.detail::text,''),left(coalesce(h.detail::text,''),1000),jsonb_build_object('duration_minutes',h.duration_minutes,'distance_km',h.distance_km::text,'calories_kcal',h.calories_kcal::text)
        from health_workout_sessions h where ${include('health_workout')} and h.subject_id=${subjectId} and h.effective
      union all
      select 'trip',t.id,t.revision,'travel',left(t.title,150),t.starts_on,null,t.time_zone,'trip',null,null,t.id,t.title||' '||coalesce(t.note,''),left(coalesce(t.note,''),1000),jsonb_build_object('ends_on',t.ends_on::text,'actual_visit','read_detail')
        from trips t where ${include('trip')} and (t.subject_id=${subjectId} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subjectId}))
      union all
      select 'library_item',i.id,r.revision,'library',left(i.title,150),coalesce(r.document_date,(i.created_at at time zone ${input.time_zone})::date),null,${input.time_zone},i.item_type,null,null,i.id,
        i.title||' '||coalesce(r.text,'')||' '||coalesce(r.url,'')||' '||r.tags::text,left(coalesce(r.text,r.url,''),1000),jsonb_build_object('historical_revision',r.revision<>i.current_revision,'processing','read_detail')
        from library_items i join library_revisions r on r.item_id=i.id and (r.revision=i.current_revision or exists(select 1 from jsonb_to_recordset(${refs}) ref(kind text,id text,revision integer) where ref.kind='library_item' and ref.id=i.id and ref.revision=r.revision)) where ${include('library_item')} and i.subject_id=${subjectId} and i.state='active'
    ), dated as (
      select *,case when occurred_at is null then business_on else (occurred_at at time zone ${input.time_zone})::date end happened_on from facts
    ), selected as materialized (
      select * from dated where position(${query} in lower(searchable))>0
        and (${input.from_on??null}::date is null or happened_on>=${input.from_on??null}::date)
        and (${input.to_on_exclusive??null}::date is null or happened_on<${input.to_on_exclusive??null}::date)
        and (jsonb_array_length(${refs})=0 or exists(select 1 from jsonb_to_recordset(${refs}) ref(kind text,id text,revision integer) where ref.kind=dated.kind and ref.id=dated.id and ref.revision=dated.revision))
    ), page as (
      select * from selected order by happened_on desc,kind desc,id desc,revision desc limit ${input.limit} offset ${input.offset}
    ), valid_memories as materialized (
      select m.* from user_memories m where m.subject_id=${subjectId} and m.state='active'
        and ${agentRefsAvailable(subjectId,sql`m.evidence_refs`)}
        and not exists(select 1 from jsonb_to_recordset(m.evidence_refs) ref(kind text,id text,revision integer) where not (ref.kind=any(${textArray(kinds)})))
        and (m.category='explicit_preference' or (m.category='deterministic_aggregate' and m.algorithm_version=${mealCountAggregate.version} and jsonb_array_length(m.evidence_refs)>0
          and not exists(select 1 from jsonb_to_recordset(m.evidence_refs) ref(kind text,id text,revision integer) where ref.kind<>${mealCountAggregate.kind})
          and (select count(distinct ref.id) from jsonb_to_recordset(m.evidence_refs) ref(kind text,id text,revision integer))=jsonb_array_length(m.evidence_refs)
          and m.value=jsonb_build_object(${mealCountAggregate.valueKey}::text,jsonb_array_length(m.evidence_refs))))
        and not exists(select 1 from unnest(array['daily','spending','health','travel','library','planning']) scope where (m.memory_key=scope or starts_with(m.memory_key,scope||'.')) and not(scope=any(${textArray(options.preferenceScopes)})))
        and (${input.scenario??null}::text is null or m.memory_key=${input.scenario??null} or starts_with(m.memory_key,${input.scenario??''}||'.') or (m.category='deterministic_aggregate' and exists(select 1 from jsonb_to_recordset(m.evidence_refs) ref(kind text,id text,revision integer) join selected f on f.kind=ref.kind and f.id=ref.id and f.revision=ref.revision)))
        and (m.memory_key=any(${textArray(input.memory_keys)}) or (${input.scenario??null}::text is not null and (m.memory_key=${input.scenario??null} or starts_with(m.memory_key,${input.scenario??''}||'.'))) or (${query}<>'' and position(${query} in lower(m.memory_key||' '||m.value::text))>0) or (m.category='deterministic_aggregate' and exists(select 1 from jsonb_to_recordset(m.evidence_refs) ref(kind text,id text,revision integer) join selected f on f.kind=ref.kind and f.id=ref.id and f.revision=ref.revision)))
    )
    select (${agentRefsAvailable(subjectId,refs)} and not exists(select 1 from jsonb_to_recordset(${JSON.stringify(options.memoryRefs??[])}::jsonb) ref(id text,revision integer) where not exists(select 1 from user_memories m where m.id=ref.id and m.subject_id=${subjectId} and m.revision=ref.revision and m.state='active'))) "refsAvailable",to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') "asOf",
      (select count(*)::int from selected) "matchedRecords",(select count(*)::int from valid_memories) "matchedMemories",
      coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'ref',jsonb_build_object('kind',kind,'id',id,'revision',revision),'domain',domain,'title',title,'happened_on',happened_on::text,'time_zone',time_zone,'source_type',source_type,'amount',amount,'currency',currency,
        'excerpt',case when ${input.response_format==='detailed'} then excerpt end,'facts',case when ${input.response_format==='detailed'} then facts end,
        'detail',jsonb_build_object('capability',case when domain in('meals','money') then 'life.get_record' when domain='health' then 'health.get_record' when domain='travel' then 'travel.get_trip' else 'library.get_item' end,'input',jsonb_build_object('id',detail_id))
      ))||jsonb_build_object('occurred_at',case when occurred_at is null then null else to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end) order by happened_on desc,kind desc,id desc,revision desc) from page),'[]'::jsonb) records,
      coalesce((select jsonb_agg(value order by updated_at desc,id desc) from (select id,updated_at,jsonb_build_object('id',id,'category',category,'memory_key',memory_key,'value',value,'evidence_refs',evidence_refs,'algorithm_version',algorithm_version,'state',state,'revision',revision,'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) value from valid_memories where octet_length(value::text)<=${input.byte_budget} order by updated_at desc,id desc limit 20) m),'[]'::jsonb) memories
  `);
  return result.rows[0]!;
}
