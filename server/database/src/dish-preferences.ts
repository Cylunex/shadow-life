import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { saveDishPreferenceSchema, type DishPreferenceQuery } from "@shadow/contracts";
import { conflict, invalidInput, type TransactionStore } from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function saveDishPreference(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const input=saveDishPreferenceSchema.parse(command.input);
  if(input.purchase_item_id){
    const source=await database.execute(sql`select i.id from purchase_items i join purchases p on p.id=i.purchase_id
      join consumption_records r on r.id=p.record_id where i.id=${input.purchase_item_id} and p.subject_id=${subjectId}
      and r.state='confirmed' and i.detail_role<>'folded_summary' for share of i,p,r`);
    if(!source.rowCount)throw invalidInput("请选择本人已确认的购买明细",["purchase_item_id"]);
  }
  const result=await database.execute<{id:string;revision:number}>(sql`
    insert into dish_preferences as prior (id,subject_id,shop_source,shop_name,dish_name,preference,note,purchase_item_id)
    select ${nextId("dish")},${subjectId},${input.shop_source},${input.shop_name},${input.dish_name},${input.preference},${input.note??null},${input.purchase_item_id??null}
    where ${input.expected_revision??null}::int is null or exists(select 1 from dish_preferences where subject_id=${subjectId}
      and shop_source=${input.shop_source} and shop_name=${input.shop_name} and dish_name=${input.dish_name})
    on conflict(subject_id,shop_source,shop_name,dish_name) do update set preference=excluded.preference,note=excluded.note,
      purchase_item_id=case when prior.preference='cleared' then excluded.purchase_item_id else coalesce(excluded.purchase_item_id,prior.purchase_item_id) end,
      revision=prior.revision+1,updated_at=now()
    where prior.revision=${input.expected_revision??null} or (prior.preference='cleared' and ${input.expected_revision??null}::int is null)
    returning id,revision`);
  const row=result.rows[0];
  if(!row)throw conflict("菜品偏好已更新，请重新读取");
  return {resources:[{type:"dish_preference",id:row.id,revision:row.revision}],actualValues:{preference_id:row.id,revision:row.revision}};
}

export async function readDishPreferences(database:Database,subjectId:string,input:DishPreferenceQuery){
  const {rows}=await database.execute<{id:string;updated_at:string}>(sql`
    select d.id,d.shop_source,d.shop_name,d.dish_name,d.preference,d.note,d.revision,
      case when r.state='confirmed' then d.purchase_item_id end purchase_item_id,
      to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at
    from dish_preferences d left join purchase_items i on i.id=d.purchase_item_id left join purchases p on p.id=i.purchase_id
    left join consumption_records r on r.id=p.record_id and r.subject_id=d.subject_id
    where d.subject_id=${subjectId} and d.preference<>'cleared'
    ${input.shop_name?sql`and d.shop_name=${input.shop_name}`:sql` `}
    ${input.shop_source?sql`and d.shop_source=${input.shop_source}`:sql` `}
    ${input.before_at?sql`and (d.updated_at,d.id)<(${input.before_at}::timestamptz,${input.before_id})`:sql` `}
    order by d.updated_at desc,d.id desc limit ${input.limit+1}`);
  const items=rows.slice(0,input.limit);
  const last=items.at(-1);
  return {items,next:rows.length>input.limit&&last?{before_at:last.updated_at,before_id:last.id}:null};
}
