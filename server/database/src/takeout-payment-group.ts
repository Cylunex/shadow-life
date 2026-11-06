import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
const vendor=(value:string)=>value.normalize("NFKC").replace(/外卖订单$/u,"").replace(/[\s·•・\-—()（）>›]/gu,"");
/** Read-only candidate grouping; no inferred transaction identity or new financial write. */
export async function relatedTakeoutPayment(db:Pick<NodePgDatabase<any>,"execute">,subject:string,fields:Record<string,any>,zone:string):Promise<string|null>{
 const detail=fields.takeout;
 if(!detail?.complete||!detail.amounts_reconciled||detail.issues?.length||!fields.merchant||!fields.order_time||!fields.paid_amount)return null;
 const platform=detail.payment_method==="支付宝"?"alipay":["微信","微信支付"].includes(detail.payment_method)?"wechat":null;if(!platform)return null;
 const at=Date.parse(String(fields.order_time).replace(" ","T")+"Z");if(!Number.isFinite(at))return null;
 const rows=await db.execute(sql`select o.record_id,o.fields,o.conflict from capture_orders o
  join consumption_records r on r.id=o.record_id and r.subject_id=o.subject_id and r.state='confirmed'
  where o.subject_id=${subject} and o.platform=${platform} and o.source_account='default'
   and o.status='paid' and o.fields->>'paid_amount'=${String(fields.paid_amount)}
   and exists(select 1 from capture_order_sources s join activity_captures a on a.id=s.capture_id
     where s.order_id=o.id and a.subject_id=${subject} and a.deleted_at is null and a.time_zone=${zone}) limit 201`);
 if(rows.rows.length>200)return null;
 const matches=new Set<string>();
 for(const row of rows.rows){const f=row.fields as Record<string,unknown>;const time=typeof f.payment_time==='string'?Date.parse(f.payment_time.replace(" ","T")+"Z"):NaN;
  if(!(time>=at&&time-at<=120000)||![f.merchant,f.product].some(v=>typeof v==='string'&&vendor(v)===vendor(String(fields.merchant))))continue;
  if(row.conflict)return null;matches.add(String(row.record_id));
 }
 return matches.size===1?[...matches][0]!:null;
}
