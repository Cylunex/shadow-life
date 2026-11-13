import {sql} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {purchasePriceSpecSchema,type PriceQuery} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
export async function savePriceSpec(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=purchasePriceSpecSchema.parse(command.input);
  const source=await database.execute(sql`select i.id from purchase_items i join purchases p on p.id=i.purchase_id
    join consumption_records r on r.id=p.record_id where p.subject_id=${subjectId} and i.id=${v.purchase_item_id} and r.state='confirmed'
    and i.detail_role<>'folded_summary' and (${v.discount}::numeric=0 or i.line_amount>=${v.discount}::numeric) for update of i`);
  if(!source.rowCount)throw conflict("购买明细不可用或优惠超过行金额");
  const prior=(await database.execute<{id:string;revision:number}>(sql`select id,revision from purchase_price_specs where purchase_item_id=${v.purchase_item_id}`)).rows[0];
  if(prior?.revision!==v.expected_revision)throw conflict("规格已更新，请重新读取");
  const id=prior?.id??nextId("pricespec"),revision=(prior?.revision??0)+1;
  await database.execute(sql`insert into purchase_price_specs(id,subject_id,purchase_item_id,product,pack_count,pack_size,unit,price_basis,discount,revision)
    values(${id},${subjectId},${v.purchase_item_id},${v.product},${v.pack_count},${v.pack_size},${v.unit},${v.price_basis},${v.discount},${revision})
    on conflict(purchase_item_id) do update set product=excluded.product,pack_count=excluded.pack_count,pack_size=excluded.pack_size,
    unit=excluded.unit,price_basis=excluded.price_basis,discount=excluded.discount,revision=excluded.revision`);
  return {resources:[{type:"purchase_price_spec",id,revision}],actualValues:{purchase_item_id:v.purchase_item_id,revision}};
}

export async function readPrices(database:Database,subject:string,v:PriceQuery){
  const data=sql`with base as (
    select i.id,p.record_id,p.occurred_on,p.merchant,p.currency,i.raw_name,i.line_amount,
      coalesce(s.product,a.target_value,i.raw_name) product,
      coalesce(s.unit,case lower(i.unit) when '公斤' then 'kg' when '千克' then 'kg' when 'kg' then 'kg' when '克' then 'g' when 'g' then 'g'
        when '升' then 'L' when 'l' then 'L' when '毫升' then 'ml' when 'ml' then 'ml' when '件' then '件' end) unit,
      coalesce(s.pack_count,1) pack_count,coalesce(s.pack_size,i.quantity) pack_size,coalesce(s.price_basis,'listed') price_basis,
      coalesce(s.discount,0) discount,s.revision,
      coalesce(ref.total,0)>0 has_refund,ref.unassigned,coalesce(ref.line_refund,0) line_refund
    from purchases p join consumption_records r on r.id=p.record_id and r.state='confirmed'
    join purchase_items i on i.purchase_id=p.id and i.detail_role<>'folded_summary'
    left join lateral(select sum(f.amount) total,bool_or(f.amount<>alloc.total) unassigned,sum(alloc.item_total) line_refund
      from active_purchase_refunds f cross join lateral(select coalesce(sum(a.amount),0) total,
        coalesce(sum(a.amount) filter(where c.purchase_item_id=i.id),0) item_total from return_allocations a join return_cases c on c.id=a.case_id
        where a.refund_entry_id=f.refund_entry_id) alloc where f.subject_id=p.subject_id and f.record_id=p.record_id) ref on true
    left join purchase_price_specs s on s.purchase_item_id=i.id and s.subject_id=p.subject_id
    left join personal_aliases a on a.subject_id=p.subject_id and a.target_kind='food' and a.alias=i.raw_name
    where p.subject_id=${subject}
  ), priced as (
    select *,case when unit in('g','kg') then 'kg' when unit in('ml','L') then 'L' when unit='件' then '件' end base_unit,
      case when unit in('g','ml') then pack_count*pack_size/1000 when unit is not null then pack_count*pack_size end quantity
    from base
  ), samples as (
    select *,case when quantity>0 and line_amount>=discount+line_refund and not coalesce(unassigned,false) then round((line_amount-discount-line_refund)/quantity,6) end unit_price
    from priced
  )`;
  const stats=(await database.execute<{total:number;identified:number;convertible:number;comparable:number;qualified:number}>(sql`${data}
    select count(*)::int total,count(*) filter(where product is not null)::int identified,count(*) filter(where quantity>0)::int convertible,
      count(unit_price)::int comparable,(select count(distinct product)::int from (select product from samples where unit_price is not null
        group by product,currency,base_unit,price_basis having count(distinct record_id)>=3) g) qualified from samples`)).rows[0]!;
  const result=await database.execute<{id:string;occurred_on:string}>(sql`${data} select id,record_id,occurred_on::text,merchant,currency,raw_name,product,
    line_amount::text,price_basis,pack_count::text,pack_size::text,unit,discount::text,revision,base_unit,unit_price::text,has_refund
    from samples where true ${v.product?sql`and product=${v.product}`:sql` `}
      ${v.item_id?sql`and id=${v.item_id}`:sql` `} ${v.before_id?sql`and (occurred_on,id)<(${v.before_on}::date,${v.before_id})`:sql` `}
    order by occurred_on desc,id desc limit ${v.limit+1}`);
  const items=result.rows.slice(0,v.limit),last=items.at(-1);
  return {items,coverage:stats,next:result.rows.length>v.limit&&last?{before_on:last.occurred_on,before_id:last.id}:null};
}
