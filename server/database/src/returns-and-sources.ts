import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {saveReturnCaseSchema,type returnCasesInputSchema,type consumptionSourcesInputSchema} from "@shadow/contracts";
import {conflict,notFound,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function saveReturnCase(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveReturnCaseSchema.parse(command.input);
  const item=(await db.execute<{record_id:string}>(sql`select p.record_id from purchases p join purchase_items i on i.purchase_id=p.id
    join consumption_records r on r.id=p.record_id where i.id=${v.purchase_item_id} and p.subject_id=${subjectId} and p.currency=${v.currency}
    and r.state='confirmed' and i.detail_role<>'folded_summary' for update of p`)).rows[0];
  if(!item)throw conflict("购买行或币种不匹配");
  const id=v.case_id??nextId("returncase");
  const prior=(await db.execute<{revision:number}>(sql`select revision from return_cases where id=${id} and subject_id=${subjectId} and purchase_item_id=${v.purchase_item_id} for update`)).rows[0];
  if(prior?.revision!==v.expected_revision)throw conflict("售后事项已更新或不可用");
  for(const allocation of v.allocations){
    const valid=await db.execute(sql`select f.refund_entry_id from active_purchase_refunds f where f.subject_id=${subjectId} and f.record_id=${item.record_id}
      and f.refund_entry_id=${allocation.refund_entry_id} and f.currency=${v.currency} and f.amount-coalesce((select sum(a.amount) from return_allocations a
      where a.refund_entry_id=f.refund_entry_id and a.case_id<>${id}),0)>=${allocation.amount}::numeric`);
    if(!valid.rowCount)throw conflict("待分配金额超出已到账且属于本单的退款余额");
  }
  const revision=(prior?.revision??0)+1;
  await db.execute(sql`insert into return_cases(id,subject_id,purchase_item_id,currency,expected_amount,returned_on,note,revision)
    values(${id},${subjectId},${v.purchase_item_id},${v.currency},${v.expected_amount},${v.returned_on??null},${v.note??null},${revision})
    on conflict(id) do update set expected_amount=excluded.expected_amount,returned_on=excluded.returned_on,note=excluded.note,revision=excluded.revision`);
  await db.execute(sql`delete from return_allocations where case_id=${id}`);
  for(const a of v.allocations)await db.execute(sql`insert into return_allocations(case_id,refund_entry_id,amount) values(${id},${a.refund_entry_id},${a.amount})`);
  return {resources:[{type:"return_case",id,revision}],actualValues:{case_id:id,revision}};
}
export async function returnCases(db:Database,subject:string,v:ReturnType<typeof returnCasesInputSchema.parse>,_effects:ReadonlySet<string>){
  const result=await db.execute(sql`select c.id,c.purchase_item_id,c.revision,c.currency,c.expected_amount::text,c.returned_on::text,c.note,
    p.record_id,i.raw_name name,ref.received::text,(c.expected_amount-ref.received)::text remaining,ref.refunds
    from return_cases c join purchase_items i on i.id=c.purchase_item_id join purchases p on p.id=i.purchase_id
    cross join lateral(select coalesce(sum(a.amount),0) received,coalesce(jsonb_agg(jsonb_build_object('refund_entry_id',f.refund_entry_id,'amount',f.amount::text,
      'allocated',coalesce(a.amount,0)::text,'available',(f.amount-coalesce((select sum(o.amount) from return_allocations o where o.refund_entry_id=f.refund_entry_id and o.case_id<>c.id),0))::text)
      order by f.refund_entry_id),'[]') refunds from active_purchase_refunds f left join return_allocations a on a.case_id=c.id and a.refund_entry_id=f.refund_entry_id
      where f.record_id=p.record_id and f.subject_id=c.subject_id and f.currency=c.currency) ref
    where c.subject_id=${subject} ${v.purchase_item_id?sql`and i.id=${v.purchase_item_id}`:sql` `}
    order by c.id offset ${v.offset} limit ${v.limit+1}`);
  return {items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}
export async function consumptionSources(db:Database,subject:string,{record_id}:ReturnType<typeof consumptionSourcesInputSchema.parse>,effects:ReadonlySet<string>){
  const record=(await db.execute<{state:string}>(sql`select state from consumption_records where id=${record_id} and subject_id=${subject}`)).rows[0];
  if(!record)throw notFound("消费记录");
  const rows=await db.execute(sql`with refs as (
    select source_id from money_entries where subject_id=${subject} and record_id=${record_id}
    union select source_id from purchases where subject_id=${subject} and record_id=${record_id}
    union select l.source_id from purchase_source_links l join purchases p on p.id=l.purchase_id where p.subject_id=${subject} and p.record_id=${record_id})
    select 'linked' relation,case when s.external_id like 'cmb-mail:%' or s.kind='email' then 'mail' else 'source' end kind,
      s.id,s.external_id,null::text batch_id,null::text source_name,'[]'::jsonb capture_ids from refs join sources s on s.id=refs.source_id where s.subject_id=${subject}
    union all select case when c.linked_record_id=${record_id} then 'linked' else 'suspected_duplicate' end,'import_candidate',c.id,c.external_id,b.id,b.source_name,'[]'
      from money_import_candidates c join money_import_batches b on b.id=c.batch_id and b.subject_id=c.subject_id where c.subject_id=${subject}
      and (c.linked_record_id=${record_id} or c.duplicate_of_record_id=${record_id})
    union all select case when o.conflict then 'order_conflict' else 'linked' end,'android_order',o.id,o.external_id,null,o.platform,
      coalesce((select jsonb_agg(c.id order by c.id) from capture_order_sources s join activity_captures c on c.id=s.capture_id
      where s.order_id=o.id and c.subject_id=${subject} and c.deleted_at is null),'[]')
      from capture_orders o where o.subject_id=${subject} and o.record_id=${record_id} and ${effects.has("library.item.read")}
    order by kind,id`);
  return {record_id,state:record.state,items:rows.rows};
}

export async function reconcileExpenses(db:Database,subject:string,v:ReturnType<typeof import("@shadow/contracts").reconciliationInputSchema.parse>,effects:ReadonlySet<string>){
  const query=sql`with entries as (select r.id record_id,r.occurred_on,r.occurred_at,m.payment_method,m.counterparty,m.amount
    from consumption_records r join money_entries m on m.record_id=r.id and m.subject_id=r.subject_id where r.subject_id=${subject} and r.state='confirmed'
    and r.occurred_on between ${v.from}::date and ${v.to}::date and m.currency=${v.currency} and m.entry_type='expense'),
    groups as (select occurred_on,amount,count(*) n from entries group by occurred_on,amount having count(*)>1)`;
  const summary=(await db.execute<{confirmed_expenses:number;gross_amount:string;candidate_groups:number}>(sql`${query} select count(*)::int confirmed_expenses,
    coalesce(sum(amount),0)::text gross_amount,(select count(*)::int from groups) candidate_groups from entries`)).rows[0]!;
  const page=await db.execute(sql`${query} select g.occurred_on::text,g.amount::text,
    case when count(e.occurred_at)=count(*) and count(distinct e.occurred_at)=1 then 'same_time_amount' else 'same_day_amount' end basis,
    jsonb_agg(jsonb_build_object('record_id',e.record_id,'occurred_at',e.occurred_at,'payment_method',e.payment_method,'counterparty',e.counterparty,
      'import_ids',coalesce((select jsonb_agg(distinct c.external_id) from money_import_candidates c where c.subject_id=${subject} and c.linked_record_id=e.record_id and c.external_id is not null),'[]'),
      'order_ids',coalesce((select jsonb_agg(distinct o.external_id) from capture_orders o where o.subject_id=${subject} and o.record_id=e.record_id and ${effects.has("library.item.read")}), '[]'))
      order by e.record_id) records from groups g join entries e using(occurred_on,amount)
    group by g.occurred_on,g.amount order by g.occurred_on,g.amount offset ${v.offset} limit ${v.limit+1}`);
  return {...summary,from:v.from,to:v.to,currency:v.currency,items:page.rows.slice(0,v.limit),next_offset:page.rows.length>v.limit?v.offset+v.limit:null};
}
