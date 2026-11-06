import { paymentCaptureContextSchema } from "@shadow/contracts";
import { relatedPaymentRecord } from "@shadow/kernel";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** A read projection only: original sources and ledger records are never merged or deleted. */
export async function readRelatedPaymentRecord(db:Pick<NodePgDatabase<any>,"execute">,subject:string,source:Record<string,unknown>):Promise<string|null>{
 const context=paymentCaptureContextSchema.safeParse(source.payment_context);
 if(!context.success||source.kind!=="screen_text"||!source.text||source.consumption_record_id)return null;
 const started=source.started_at instanceof Date?source.started_at.toISOString():String(source.started_at);
 const candidates=await db.execute(sql`select a.*,o.record_id,o.platform,o.source_account,o.conflict
  from capture_orders o join capture_order_sources s on s.order_id=o.id
  join activity_captures a on a.id=s.capture_id and a.subject_id=o.subject_id
  join consumption_records r on r.id=o.record_id and r.subject_id=o.subject_id and r.state='confirmed'
  where o.subject_id=${subject} and o.platform=${context.data.platform} and o.source_account=${context.data.source_account}
   and a.device_id=${String(source.device_id)} and a.deleted_at is null and a.time_zone=${String(source.time_zone)}
   and r.occurred_on between ((${started}::timestamptz-interval '15 seconds') at time zone ${String(source.time_zone)})::date
     and (${started}::timestamptz at time zone ${String(source.time_zone)})::date
  order by a.id limit 201`);
 if(candidates.rows.length>200)return null;
 return relatedPaymentRecord({id:String(source.id),device_id:String(source.device_id),app_package:String(source.app_package),text:String(source.text),started_at:started,time_zone:String(source.time_zone),...context.data},candidates.rows.map(r=>({id:String(r.id),device_id:String(r.device_id),app_package:String(r.app_package),text:String(r.text??""),started_at:String(r.started_at),time_zone:String(r.time_zone),platform:String(r.platform),source_account:String(r.source_account),record_id:String(r.record_id),conflict:Boolean(r.conflict)})));
}
