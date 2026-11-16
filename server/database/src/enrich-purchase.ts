import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {enrichPurchaseInputSchema} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

/** Add missing purchase facts to an existing payment; never create a second payment. */
export async function enrichPurchase(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=enrichPurchaseInputSchema.parse(command.input);
  const current=await database.execute<{record:Record<string,unknown>;currency:string;entry_type:string}>(sql`
    select to_jsonb(r) record,m.currency,m.entry_type from consumption_records r
    join money_entries m on m.record_id=r.id and m.subject_id=${subjectId}
    where r.id=${v.record_id} and r.subject_id=${subjectId} and r.state='confirmed'
      and r.revision=${v.expected_revision} for update of r,m`);
  if(!current.rowCount||current.rows[0]!.entry_type!=="expense")throw conflict("Read a current confirmed expense before adding purchase details");
  const existing=await database.execute(sql`select id from purchases where record_id=${v.record_id}`);
  if(existing.rowCount)throw conflict("Purchase already exists; read it and use life.update_purchase_items instead of creating another purchase");
  // Reuse originals owned by the same subject and exact current Library revisions.
  const sourceIds=new Set<string>();
  for(const ref of v.library_items){
    const item=await database.execute<{source_id:string|null}>(sql`select source_id from library_items
      where id=${ref.id} and subject_id=${subjectId} and state='active' and current_revision=${ref.revision} for share`);
    if(!item.rowCount||!item.rows[0]!.source_id)throw conflict("Library original or revision is unavailable");
    const source=await database.execute(sql`select id from sources where id=${item.rows[0]!.source_id} and subject_id=${subjectId}`);
    if(!source.rowCount)throw conflict("Library original is unavailable");
    sourceIds.add(item.rows[0]!.source_id!);
  }
  const record=current.rows[0]!.record,purchaseId=nextId("purchase");
  await database.execute(sql`insert into consumption_record_revisions(record_id,revision,snapshot,reason)
    values(${v.record_id},${v.expected_revision},${JSON.stringify({record})}::jsonb,${v.reason})`);
  const originalIds=[...sourceIds];
  await database.execute(sql`insert into purchases(id,subject_id,record_id,merchant,currency,occurred_on,occurred_at,time_zone,note,scene,channel_name_raw,source_id)
    values(${purchaseId},${subjectId},${v.record_id},${v.merchant_name_raw??null},${current.rows[0]!.currency},
      ${record.occurred_on}::date,${record.occurred_at??null}::timestamptz,${record.time_zone},${v.note??null},${v.scene},${v.channel_name_raw??null},${originalIds[0]})`);
  for(const id of originalIds)await database.execute(sql`insert into purchase_source_links(purchase_id,source_id,role) values(${purchaseId},${id},'order_screenshot')`);
  const itemIds:string[]=[];
  for(const [position,item] of v.items.entries()){
    const id=nextId("purchase_item");itemIds.push(id);
    await database.execute(sql`insert into purchase_items(id,purchase_id,position,raw_name,quantity,unit,line_amount,category_key)
      values(${id},${purchaseId},${position},${item.raw_name},${item.quantity??null},${item.unit??null},${item.line_amount??null},${item.category_key??null})`);
  }
  const revision=v.expected_revision+1;
  await database.execute(sql`update consumption_records set record_kind='consumption',revision=${revision},updated_at=now()
    where id=${v.record_id} and subject_id=${subjectId}`);
  return {resources:[{type:"consumption_record",id:v.record_id,revision},{type:"purchase",id:purchaseId,revision:1},
    ...itemIds.map(id=>({type:"purchase_item" as const,id,revision:1})),...originalIds.map(id=>({type:"source" as const,id,revision:1}))],
    actualValues:{record_id:v.record_id,purchase_id:purchaseId,items:v.items.length,source_count:originalIds.length,library_item_count:v.library_items.length,payment_unchanged:true}};
}
