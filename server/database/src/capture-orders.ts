import { paymentCaptureContextSchema } from "@shadow/contracts";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ExecutionResult,UniversalCommandEnvelope } from "@shadow/contracts";
import { readTakeoutCapture,inspectActivityOrder,mergeOrderObservations,capturedPaymentIdentity,capturedPaymentPlatform,capturedPaymentHasCnyEvidence,parseMoneyStatement,type RequestContext } from "@shadow/kernel";
type DB=Pick<NodePgDatabase<any>,"execute">;
type Result={resources:ExecutionResult["resources"];actualValues:ExecutionResult["actual_values"]};
export async function associateCapturedOrder(db:DB,subject:string,captureId:string,context:RequestContext|undefined,nextId:(kind:string)=>string,nested:(command:UniversalCommandEnvelope)=>Promise<Result>,commandId:string,recordExpense=false):Promise<ExecutionResult["resources"]|undefined>{
 const captured=(await db.execute(sql`select * from activity_captures where id=${captureId} and subject_id=${subject} and kind='screen_text' and deleted_at is null`)).rows[0];if(!captured||!captured.app_package||!captured.text)return;
 // Explicit gestures are a write intent, independent of the background collection switch.
 // Reprocessing a saved source keeps its original platform/account even if settings changed.
 const associated=recordExpense?(await db.execute(sql`select o.platform,o.source_account from capture_orders o join capture_order_sources s on s.order_id=o.id where o.subject_id=${subject} and s.capture_id=${captureId} order by o.id limit 1`)).rows[0]:undefined;
 const configured=(await db.execute(sql`select * from capture_order_rules where subject_id=${subject} and app_package=${String(captured.app_package)}`)).rows[0];
 const observedContext=paymentCaptureContextSchema.safeParse(captured.payment_context);
 const paymentContext=observedContext.success?observedContext.data:undefined;
 const paymentPlatform=capturedPaymentPlatform(String(captured.app_package));
 const takeout=readTakeoutCapture(String(captured.text));
 const rule:Record<string,unknown>|undefined=takeout?{platform:takeout.platform,source_account:configured?.platform===takeout.platform?configured.source_account:"default"}:recordExpense?(associated??paymentContext??configured??(paymentPlatform?{platform:paymentPlatform,source_account:"default"}:undefined)):(configured?.enabled?configured:undefined);
 if(!rule)return;
 async function recordResources(recordId:string):Promise<ExecutionResult["resources"]>{
   const rows=(await db.execute(sql`select r.id,r.revision,m.id money_id,m.revision money_revision from consumption_records r join money_entries m on m.record_id=r.id and m.subject_id=${subject} where r.id=${recordId} and r.subject_id=${subject}`)).rows;
   return rows.flatMap(r=>[{type:"consumption_record" as const,id:String(r.id),revision:Number(r.revision)},{type:"money_entry" as const,id:String(r.money_id),revision:Number(r.money_revision)}]);
 }
 const observation=inspectActivityOrder(String(captured.text),String(rule.platform),Boolean(paymentContext));const identity=observation.order_id??observation.transaction_id;if(!identity)return;
 await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${subject}:capture-orders`},13))`);
 const found=await db.execute(sql`select * from capture_orders where subject_id=${subject} and platform=${String(rule.platform)} and source_account=${String(rule.source_account)} and (external_id=${identity} or (${observation.order_id}::text is not null and fields->>'order_id'=${observation.order_id}) or (${observation.transaction_id}::text is not null and fields->>'transaction_id'=${observation.transaction_id})) for update`);
 if(found.rows.length>1){
  const ids=found.rows.map(r=>String(r.id)),records=new Set(found.rows.map(r=>r.record_id).filter(Boolean));
  const previous=await db.execute(sql`select a.text,a.payment_context from capture_order_sources s join activity_captures a on a.id=s.capture_id and a.deleted_at is null where s.order_id in (${sql.join(ids.map(value=>sql`${value}`),sql`,`)})`);
  const combined=mergeOrderObservations([...previous.rows.map(r=>inspectActivityOrder(String(r.text??""),String(rule.platform),paymentCaptureContextSchema.safeParse(r.payment_context).success)),observation]);
  if(!observation.order_id||!observation.transaction_id||records.size>1||combined.conflict){for(const row of found.rows)await db.execute(sql`update capture_orders set conflict=true where id=${String(row.id)}`);return;}
  const canonical=found.rows.find(r=>r.record_id)??found.rows[0]!;
  for(const obsolete of found.rows.filter(r=>r.id!==canonical.id)){
   await db.execute(sql`insert into capture_order_sources(order_id,capture_id,fields) select ${String(canonical.id)},capture_id,fields from capture_order_sources where order_id=${String(obsolete.id)} on conflict do nothing`);
   await db.execute(sql`delete from capture_order_sources where order_id=${String(obsolete.id)}`);await db.execute(sql`delete from capture_orders where id=${String(obsolete.id)}`);
  }
  found.rows=[canonical];
 }
 const old=found.rows[0],id=old?String(old.id):nextId("capture_order");
 if(!old)await db.execute(sql`insert into capture_orders(id,subject_id,platform,source_account,external_id,identity_kind,fields,status) values(${id},${subject},${String(rule.platform)},${String(rule.source_account)},${identity},'expense','{}','unknown')`);
 await db.execute(sql`insert into capture_order_sources(order_id,capture_id,fields) values(${id},${captureId},${JSON.stringify(observation)}::jsonb) on conflict(order_id,capture_id) do update set fields=excluded.fields`);
 const sources=await db.execute(sql`select a.text,a.payment_context from capture_order_sources s join activity_captures a on a.id=s.capture_id and a.deleted_at is null where s.order_id=${id} order by a.started_at,a.id`);
 const merged=mergeOrderObservations(sources.rows.map(s=>inspectActivityOrder(String(s.text??""),String(rule.platform),paymentCaptureContextSchema.safeParse(s.payment_context).success)));
 await db.execute(sql`update capture_orders set fields=${JSON.stringify(merged.fields)}::jsonb,status=${merged.status},conflict=${merged.conflict} where id=${id}`);
 if(takeout)return; // Order observations never create another payment.
 if(old?.record_id)return recordExpense?recordResources(String(old.record_id)):undefined;
 if((!recordExpense&&!rule.auto_accounting)||merged.conflict||merged.status!=="paid")return;
 if(!context?.effects.has("money.entry.write")||!context.effects.has("life.purchase.write"))return;
 const fields=merged.fields,external=capturedPaymentIdentity(String(rule.platform),fields);
 if(typeof external!=='string'||!fields.paid_amount||!fields.payment_time)return;
 // Explicit currency evidence is mandatory. A numeric price alone does not prove CNY.
 if(!capturedPaymentHasCnyEvidence(String(captured.text),String(rule.platform),Boolean(paymentContext)))return;
 const row={transaction_id:external,date:fields.payment_time,type:"expense",amount:fields.paid_amount,merchant:fields.merchant,currency:"CNY",note:fields.product,
 "订单号":external,"订单提交时间":fields.payment_time,"订单状态":"交易成功","实付金额":fields.paid_amount,"店铺名称":fields.merchant,"商品名称":fields.product,
 "交易单号":external,"交易日期":fields.payment_time,"交易成功时间":fields.payment_time,"交易状态":"交易成功","当前状态":"交易成功","收/支":"支出","交易类型":"支付","交易对方":fields.merchant,"金额":fields.paid_amount,"币种":"CNY"};
 const platform=String(rule.platform) as Parameters<typeof parseMoneyStatement>[0]["platform"],content=JSON.stringify([row]);
 if(parseMoneyStatement({format:"json",content,timeZone:String(captured.time_zone),platform:platform!}).some(c=>c.issues.length))return;
 // Use the same staging and final identity checks as file imports; auto-accept only the new clean candidate.
 const staged=await nested({protocol:"shadow.command",command_id:commandId,capability:"money.stage_import",input:{format:"json",content,source_name:paymentContext?"Android 付款后自动记账":recordExpense?"Android 摇一摇记账":"Android 已授权自动采集",platform:platform!,source_account:String(rule.source_account),time_zone:String(captured.time_zone)}});
 const batch=String(staged.actualValues.batch_id);
 const candidate=(await db.execute(sql`select * from money_import_candidates where batch_id=${batch} and subject_id=${subject} order by position limit 1`)).rows[0];if(!candidate)return staged.resources;
 if((candidate.issues as unknown[]).length){await db.execute(sql`update capture_orders set conflict=true where id=${id}`);return staged.resources;}
 if(candidate.linked_record_id||candidate.duplicate_of_record_id){const recordId=String(candidate.linked_record_id??candidate.duplicate_of_record_id);await db.execute(sql`update capture_orders set record_id=${recordId} where id=${id}`);return [...staged.resources,...await recordResources(recordId)];}
 if(candidate.status!=='pending'||candidate.duplicate_of_candidate_id)return staged.resources;
 const confirmed=await nested({protocol:"shadow.command",command_id:commandId,capability:"money.resolve_import_candidate",input:{candidate_id:String(candidate.id),expected_revision:Number(candidate.revision),decision:"confirm",remember_rule:false,reason:paymentContext?"用户已开启付款后识别，页面具有交易身份、实付和付款时间证据":recordExpense?"用户主动摇一摇或明确补录，来源具有身份、实付和支付时间证据":"用户已开启明确平台账号的自动记账，来源具有身份、实付和支付时间证据"}});
 await db.execute(sql`update capture_orders set record_id=${String(confirmed.actualValues.record_id)} where id=${id}`);
 return [...staged.resources,...confirmed.resources];
}
