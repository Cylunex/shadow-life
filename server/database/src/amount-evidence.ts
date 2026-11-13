import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {saveAmountEvidenceSchema,type EvidenceField} from "@shadow/contracts";
import {conflict,locateOrderAmount,inspectTakeoutOrder,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
type Original={id:string;original_text:string|null;asset_version_id:string|null;kind:string};
async function originals(database:Database,subject:string,record:string){
  return (await database.execute<Original>(sql`with refs as (
    select p.source_id from purchases p where p.subject_id=${subject} and p.record_id=${record}
    union select l.source_id from purchase_source_links l join purchases p on p.id=l.purchase_id where p.subject_id=${subject} and p.record_id=${record}
    union select source_id from money_entries where subject_id=${subject} and record_id=${record}
  ) select s.id,s.original_text,s.asset_version_id,s.kind from refs join sources s on s.id=refs.source_id
      where s.subject_id=${subject} order by s.id`)).rows;
}

export async function writeAmountEvidence(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveAmountEvidenceSchema.parse(command.input);
  const record=await database.execute(sql`select id from consumption_records where id=${v.record_id} and subject_id=${subjectId} and state='confirmed' for update`);
  const original=(await originals(database,subjectId,v.record_id)).find(s=>s.id===v.source_id);
  if(!record.rowCount||!original||v.asset_version_id!==(original.asset_version_id??undefined))throw conflict("原件与消费记录不匹配");
  if(v.region&&original.kind!=="image")throw conflict("仅图像原件可保存像素坐标");
  if(v.quote&&!original.asset_version_id&&!original.original_text?.includes(v.quote))throw conflict("所引文字与原始材料不一致");
  const prior=(await database.execute<{id:string;revision:number}>(sql`select id,revision from amount_evidence where record_id=${v.record_id} and field=${v.field} for update`)).rows[0];
  if(prior?.revision!==v.expected_revision)throw conflict("字段来源已更新，请重新读取");
  const id=prior?.id??nextId("evidence"),revision=(prior?.revision??0)+1;
  await database.execute(sql`insert into amount_evidence(id,subject_id,record_id,field,source_id,asset_version_id,amount,page,quote,region,revision)
    values(${id},${subjectId},${v.record_id},${v.field},${v.source_id},${v.asset_version_id??null},${v.amount},${v.page??null},${v.quote??null},${v.region?JSON.stringify(v.region):null}::jsonb,${revision})
    on conflict(record_id,field) do update set source_id=excluded.source_id,asset_version_id=excluded.asset_version_id,
    amount=excluded.amount,page=excluded.page,quote=excluded.quote,region=excluded.region,revision=excluded.revision`);
  return {resources:[{type:"amount_evidence",id,revision}],actualValues:{evidence_id:id,revision}};
}

export async function readAmountEvidence(database:Database,subject:string,record:string,canReadLibrary:boolean){
  const sources=await originals(database,subject,record);
  const saved=(await database.execute<{field:EvidenceField;source_id:string}>(sql`select id,field,source_id,asset_version_id,amount::text,page,quote,region,revision
    from amount_evidence where record_id=${record} and subject_id=${subject} order by field`)).rows.filter(r=>sources.some(s=>s.id===r.source_id));
  const candidates:Array<{field:EvidenceField;source_id:string;asset_version_id:string|null;amount:string;page:number|null;quote:string|null;region:null;revision:null;id:null}>=sources.flatMap(s=>{
    if(!s.original_text)return [];
    const order=inspectTakeoutOrder(s.original_text);
    return (["paid","discount","delivery"] as const).flatMap(field=>{
      if(saved.some(r=>r.field===field))return [];
      const expected=field==="paid"?order?.paid_amount:field==="delivery"?order?.takeout.delivery_fee:order?.takeout.discount_amount;
      const match=locateOrderAmount(s.original_text!,field,expected??undefined);
      return match?[{field,source_id:s.id,asset_version_id:s.asset_version_id,amount:match.amount,page:null,
        quote:match.quote,region:null,revision:null,id:null}]:[];
    });
  });
  const assets=sources.filter(s=>s.asset_version_id);
  const snippets=canReadLibrary&&assets.length?(await database.execute<{text:string;locator:{page?:number};asset_version_id:string}>(sql`
    select sn.text,sn.locator,j.source_asset_version_id asset_version_id from library_snippets sn
    join library_processing_jobs j on j.id=sn.job_id and j.subject_id=sn.subject_id
    join library_items item on item.id=sn.item_id and item.current_revision=sn.item_revision
    where sn.subject_id=${subject} and j.source_asset_version_id in (${sql.join(assets.map(s=>sql`${s.asset_version_id}`),sql`,`)})
    order by sn.item_id,sn.ordinal limit 1000`)).rows:[];
  for(const sn of snippets){
    for(const field of ["paid","discount","delivery"] as const){
      if(saved.some(r=>r.field===field))continue;
      const match=locateOrderAmount(sn.text,field);
      const source=assets.find(s=>s.asset_version_id===sn.asset_version_id);
      if(match&&source)candidates.push({field,source_id:source.id,asset_version_id:sn.asset_version_id,amount:match.amount,
        page:typeof sn.locator.page==="number"?sn.locator.page:null,quote:match.quote,region:null,revision:null,id:null});
    }
  }
  return {items:[...saved,...candidates],sources:sources.map(({id,kind,asset_version_id})=>({id,kind,asset_version_id}))};
}
