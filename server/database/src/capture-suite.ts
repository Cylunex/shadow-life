import { capturePolicy,redactCaptureDerivations } from "./capture-completion.js";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { captureScreenshotSchema,recordingSegmentSchema,recordingJobSchema,completeRecordingSchema,failRecordingSchema,recordingActionSchema,reviseTranscriptSchema,orderCaptureRuleSchema,activityReviewInputSchema,type UniversalCommandEnvelope,type ExecutionResult } from "@shadow/contracts";
import { conflict,permissionDenied,sha256Fingerprinter,type RequestContext } from "@shadow/kernel";
import { buildCaptureReview,captureReviewSignature,type CaptureReviewFact } from "@shadow/kernel";
import { configuredTranscriber } from "./recording-worker.js";
import { visionAvailability,visionProcessorName } from "./vision-processor.js";
import { mergeOrderObservations } from "@shadow/kernel";
type DB=Pick<NodePgDatabase<any>,"execute">;
type WriteResult={resources:ExecutionResult["resources"];actualValues:ExecutionResult["actual_values"]};
const iso=(v:unknown)=>v instanceof Date?v.toISOString():new Date(String(v)).toISOString();
function checkSpans(spans:Array<{start_ms:number;end_ms:number}>,start:unknown,end:unknown){const duration=Date.parse(iso(end))-Date.parse(iso(start));let last=0;for(const span of spans){if(span.start_ms<last||span.end_ms>duration)throw conflict("Transcript spans must be ordered and inside the audio segment");last=span.end_ms;}}
export async function captureSnapshot(db:DB,subject:string,from:string,to:string,zone:string):Promise<CaptureReviewFact[]>{
 const rows=await db.execute(sql`select id,kind,title,greatest(started_at,${from}::date::timestamp at time zone ${zone}) started_at,least(ended_at,${to}::date::timestamp at time zone ${zone}) ended_at,left(text,300) text,md5(jsonb_build_array(text,title,latitude,longitude,accuracy_m,(select jsonb_build_array(c.behavior,c.life_domain,c.project_id,c.revision) from capture_classifications c where c.capture_id=activity_captures.id))::text) stamp from activity_captures where subject_id=${subject} and deleted_at is null and started_at<${to}::date::timestamp at time zone ${zone} and (ended_at>${from}::date::timestamp at time zone ${zone} or (started_at=ended_at and started_at>=${from}::date::timestamp at time zone ${zone})) order by started_at,id limit 50001`);
 if(rows.rows.length>50000)throw conflict("所选期间超过 50000 项来源，请缩小回顾范围");
 return rows.rows.map(r=>({id:String(r.id),kind:String(r.kind),title:String(r.title),started_at:iso(r.started_at),ended_at:iso(r.ended_at),text:r.text===null?null:String(r.text),stamp:String(r.stamp)}));
}
export async function writeCaptureSuite(db:DB,subject:string,command:UniversalCommandEnvelope,context:RequestContext|undefined,nextId:(kind:string)=>string,nested:(command:UniversalCommandEnvelope)=>Promise<WriteResult>):Promise<WriteResult|undefined>{
 const capability=command.capability;
 if(capability==="life.capture_screenshot"){
  const input=captureScreenshotSchema.parse(command.input);
  const asset=await db.execute(sql`select 1 from asset_versions v join assets a on a.id=v.asset_id where v.id=${input.asset_version_id} and a.subject_id=${subject} and a.media_type in ('image/png','image/jpeg','image/webp')`);if(!asset.rowCount)throw conflict("截图原件不可用");
  const result=await nested({protocol:"shadow.command",command_id:command.command_id,capability:"library.capture",input:{title:input.title,item_type:"image",tags:["截图收录","losna:process"],source:{kind:"image",asset_version_id:input.asset_version_id,captured_at:input.captured_at,time_zone:input.time_zone}}});
  const screenshotId=String(result.actualValues.library_item_id);
  await db.execute(sql`insert into capture_screenshot_sources(item_id,subject_id,app_package,captured_at,time_zone) values(${screenshotId},${subject},${input.app_package??null},${input.captured_at}::timestamptz,${input.time_zone})`);
  const policy=(await capturePolicy(db,subject)).policy;let canRecognize=false;
  if(visionAvailability().available&&policy.process_screenshots&&policy.daily_screenshots>0){const counted=await db.execute(sql`insert into capture_processing_counters(subject_id,on_date,kind,count) values(${subject},(clock_timestamp() at time zone 'UTC')::date,'screenshot',1) on conflict(subject_id,on_date,kind) do update set count=capture_processing_counters.count+1 where capture_processing_counters.count<${policy.daily_screenshots} returning count`);canRecognize=Boolean(counted.rowCount);}
  if(canRecognize){const queued=await nested({protocol:"shadow.command",command_id:command.command_id,capability:"library.queue_processing",input:{item_id:String(result.actualValues.library_item_id),source_asset_version_id:input.asset_version_id,kind:"vision",requested_processor:visionProcessorName}});await db.execute(sql`update library_processing_jobs set capture_automatic=true where id=${String(queued.actualValues.library_processing_job_id)} and subject_id=${subject}`);result.actualValues.vision_queued=true;}
  else result.actualValues.vision_queued=false;
  if(input.text&&input.app_package){
   const itemId=String(result.actualValues.library_item_id);
   const captured=await nested({protocol:"shadow.command",command_id:command.command_id,capability:"life.ingest_activity",input:{device_id:"screenshot_capture",items:[{source_id:itemId,kind:"screen_text",title:input.title,text:input.text,app_package:input.app_package,started_at:input.captured_at,ended_at:input.captured_at,time_zone:input.time_zone}]}});
   await db.execute(sql`update activity_captures set library_item_id=${itemId} where subject_id=${subject} and device_id='screenshot_capture' and source_id=${itemId}`);
   result.resources.push(...captured.resources);
  }
  return result;
 }
 if(capability==="life.register_recording"){
  const input=recordingSegmentSchema.parse(command.input),fingerprint=sha256Fingerprinter.fingerprint(input);
  const asset=await db.execute(sql`select 1 from asset_versions v join assets a on a.id=v.asset_id where v.id=${input.asset_version_id} and a.subject_id=${subject} and a.media_type in ('audio/mp4','audio/aac','audio/mpeg','audio/wav','audio/ogg') and v.byte_size<=10000000`);
  if(!asset.rowCount)throw conflict("本人音频原件不存在或格式／大小不受支持");
  await db.execute(sql`insert into capture_recording_segments(id,subject_id,session_id,segment_index,title,started_at,ended_at,time_zone,asset_version_id,fingerprint) values(${input.segment_id},${subject},${input.session_id},${input.segment_index},${input.title},${input.started_at}::timestamptz,${input.ended_at}::timestamptz,${input.time_zone},${input.asset_version_id},${fingerprint}) on conflict do nothing`);
  const existing=(await db.execute(sql`select * from capture_recording_segments where id=${input.segment_id} and subject_id=${subject}`)).rows[0];if(!existing||existing.fingerprint!==fingerprint)throw conflict("录音片段身份冲突");
  return {resources:[{type:"activity_capture",id:input.segment_id,revision:Number(existing.revision)}],actualValues:{segment_id:input.segment_id,state:String(existing.state),deleted:existing.deleted_at!==null}};
 }
 if(["life.claim_recording","life.complete_recording","life.fail_recording","life.retry_recording","life.delete_recording","life.revise_transcript"].includes(capability)){
  const raw=command.input as {segment_id:string};const row=(await db.execute(sql`select * from capture_recording_segments where id=${raw.segment_id} and subject_id=${subject} for update`)).rows[0];
  if(!row||row.deleted_at&&capability!=="life.delete_recording")throw conflict("录音片段不可用");const id=String(row.id);const projections:ExecutionResult["resources"]=[];
  if(capability==="life.claim_recording"){
   const input=recordingJobSchema.parse(command.input);
   await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${subject+':capture-audio-budget'},15))`);
   const policy=(await capturePolicy(db,subject)).policy;if(!policy.process_recordings||row.audio_expired_at)throw conflict("录音处理已暂停");
   const used=(await db.execute(sql`select coalesce(sum(extract(epoch from ended_at-started_at)),0)::double precision seconds from capture_recording_segments where subject_id=${subject} and (processed_at>=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC') or state='running' and lease_expires_at>clock_timestamp())`)).rows[0]!;
   if(Number(used.seconds)+(Date.parse(iso(row.ended_at))-Date.parse(iso(row.started_at)))/1000>policy.daily_audio_minutes*60)throw conflict("今日转写预算已用完，原件保留等待下次处理");const eligible=await db.execute(sql`select 1 from capture_recording_segments where id=${id} and attempt=${input.expected_attempt} and (state='queued' or state='running' and lease_expires_at<=clock_timestamp())`);if(!eligible.rowCount)throw conflict("Recording attempt is stale");
   const attempt=Number(row.attempt)+1;await db.execute(sql`update capture_recording_segments set state='running',attempt=${attempt},lease_expires_at=clock_timestamp()+interval '5 minutes',error=null where id=${id}`);
   return {resources:[{type:"activity_capture",id,revision:Number(row.revision)}],actualValues:{segment_id:id,attempt}};
  }
  if(capability==="life.complete_recording"||capability==="life.fail_recording"){
   const valid=(await db.execute(sql`select 1 from capture_recording_segments where id=${id} and state='running' and attempt=${(command.input as {attempt:number}).attempt} and lease_expires_at>clock_timestamp()`)).rowCount;
   if(!valid)throw conflict("Recording lease expired or attempt is stale");
   if(capability==="life.fail_recording"){const input=failRecordingSchema.parse(command.input);await db.execute(sql`update capture_recording_segments set state='failed',error=${input.message},lease_expires_at=null where id=${id}`);}
   else {const input=completeRecordingSchema.parse(command.input);checkSpans(input.spans,row.started_at,row.ended_at);
    await db.execute(sql`update capture_recording_segments set processed_at=clock_timestamp(),state='completed',spans=${JSON.stringify(input.spans)}::jsonb,processor_version=${input.processor_version},error=null,lease_expires_at=null where id=${id}`);
    const projection=await nested({protocol:"shadow.command",capability:"life.ingest_activity",command_id:command.command_id,input:{device_id:"recording_processor",items:[{source_id:id,kind:"recording",title:String(row.title),started_at:iso(row.started_at),ended_at:iso(row.ended_at),time_zone:String(row.time_zone),text:input.spans.map(s=>s.text).join("\n").slice(0,12000)}]}});projections.push(...projection.resources);
   }
  } else if(capability==="life.retry_recording"){
   recordingActionSchema.parse(command.input);if(row.state!=='failed')throw conflict("仅失败的转写可重试");await db.execute(sql`update capture_recording_segments set state='queued',error=null where id=${id}`);
  } else if(capability==="life.revise_transcript"){
   const input=reviseTranscriptSchema.parse(command.input);if(row.state!=='completed')throw conflict("请在转写完成后更正");if(Number(row.revision)!==input.expected_revision)throw conflict("转写修订已变化");checkSpans(input.spans,row.started_at,row.ended_at);
   await db.execute(sql`insert into capture_transcript_revisions(segment_id,revision,spans,reason) values(${id},${Number(row.revision)},${JSON.stringify(row.spans)}::jsonb,${input.reason})`);
   await db.execute(sql`update capture_recording_segments set spans=${JSON.stringify(input.spans)}::jsonb,revision=revision+1,attempt=attempt+1,state='completed',lease_expires_at=null,processor_version='user-correction',error=null where id=${id}`);
   await db.execute(sql`update activity_captures set text=${input.spans.map(s=>s.text).join("\n").slice(0,12000)} where subject_id=${subject} and source_id=${id} and device_id='recording_processor' and deleted_at is null`);
  } else {
   recordingActionSchema.parse(command.input);const sources=await db.execute(sql`select id from activity_captures where subject_id=${subject} and source_id=${id} and device_id='recording_processor'`);for(const source of sources.rows)await redactCaptureDerivations(db,subject,String(source.id));await db.execute(sql`update capture_recording_segments set revision=revision+case when deleted_at is null then 1 else 0 end,deleted_at=coalesce(deleted_at,now()),title='',spans='[]',error=null,attempt=attempt+1,lease_expires_at=null where id=${id}`);
   await db.execute(sql`delete from capture_transcript_revisions where segment_id=${id}`);
   await db.execute(sql`update activity_captures set deleted_at=coalesce(deleted_at,now()),title='',text=null where subject_id=${subject} and source_id=${id} and device_id='recording_processor'`);
  }
  return {resources:[{type:"activity_capture",id,revision:Number(row.revision)+(capability==="life.revise_transcript"||capability==="life.delete_recording"&&!row.deleted_at?1:0)},...projections],actualValues:{segment_id:id}};
 }
 if(capability==="life.set_order_capture"){
  const input=orderCaptureRuleSchema.parse(command.input);
  if(input.auto_accounting&&(!context?.effects.has("money.entry.write")||!context.effects.has("life.purchase.write")))throw permissionDenied("money.entry.write");
  await db.execute(sql`insert into capture_order_rules(id,subject_id,app_package,platform,source_account,enabled,auto_accounting) values(${nextId("capture_rule")},${subject},${input.app_package},${input.platform},${input.source_account},${input.enabled},${input.auto_accounting}) on conflict(subject_id,app_package) do update set platform=excluded.platform,source_account=excluded.source_account,enabled=excluded.enabled,auto_accounting=excluded.auto_accounting,revision=capture_order_rules.revision+1`);
  const saved=(await db.execute(sql`select id,revision from capture_order_rules where subject_id=${subject} and app_package=${input.app_package}`)).rows[0]!;
  return {resources:[{type:"activity_capture",id:String(saved.id),revision:Number(saved.revision)}],actualValues:{enabled:input.enabled,auto_accounting:input.auto_accounting}};
 }
 if(capability==="life.generate_activity_review"){
  const input=activityReviewInputSchema.parse(command.input);if(!context?.effects.has("library.item.read"))throw permissionDenied("library.item.read");
  // Date arithmetic uses calendar days; the selected zone controls instant boundaries.
  const date=new Date(input.date+"T00:00:00Z");if(input.period==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);if(input.period==='month')date.setUTCDate(1);
  const from=date.toISOString().slice(0,10);if(input.period==='month')date.setUTCMonth(date.getUTCMonth()+1);else date.setUTCDate(date.getUTCDate()+(input.period==='week'?7:1));const to=date.toISOString().slice(0,10);
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([subject,input.period,from,input.time_zone])},12))`);
  const facts=await captureSnapshot(db,subject,from,to,input.time_zone),signature=captureReviewSignature(facts),review=buildCaptureReview(facts,input.time_zone,input.period),body=review.body;
  const current=(await db.execute(sql`select * from capture_reviews where subject_id=${subject} and period=${input.period} and from_on=${from}::date and time_zone=${input.time_zone} for update`)).rows[0];
  const id=current?String(current.id):nextId("review");let revision=Number(current?.revision??0)+1;
  if(current?.signature===signature){revision=Number(current.revision);await db.execute(sql`update capture_reviews set generated_at=clock_timestamp() where id=${id}`); }
  else {if(current)await db.execute(sql`insert into capture_review_revisions(review_id,revision,body,signature) values(${id},${Number(current.revision)},${String(current.body)},${String(current.signature)})`);
   await db.execute(sql`insert into capture_reviews(id,subject_id,period,from_on,to_on_exclusive,time_zone,signature,body,source_refs,source_count) values(${id},${subject},${input.period},${from}::date,${to}::date,${input.time_zone},${signature},${body},${JSON.stringify(review.source_refs)}::jsonb,${facts.length}) on conflict(subject_id,period,from_on,time_zone) do update set signature=excluded.signature,body=excluded.body,source_refs=excluded.source_refs,source_count=excluded.source_count,revision=capture_reviews.revision+1,generated_at=now()`);}
  return {resources:[{type:"life_review",id,revision}],actualValues:{review_id:id,revision,source_count:facts.length}};
 }
 return undefined;
}
export async function readCaptureWorkspace(db:DB,subject:string,input:{date:string;time_zone:string;recordings_before_id?:string|undefined}){
 if(input.recordings_before_id&&!(await db.execute(sql`select 1 from capture_recording_segments where id=${input.recordings_before_id} and subject_id=${subject}`)).rowCount)throw conflict("录音分页位置不可用");
 const recordingRows=await db.execute(sql`select * from capture_recording_segments where subject_id=${subject} and deleted_at is null and started_at<(${input.date}::date+1)::timestamp at time zone ${input.time_zone} and ended_at>${input.date}::date::timestamp at time zone ${input.time_zone} and (${input.recordings_before_id??null}::text is null or (started_at,id)<(select started_at,id from capture_recording_segments where id=${input.recordings_before_id??null} and subject_id=${subject})) order by started_at desc,id desc limit 101`);
 const orderRows=await db.execute(sql`select o.*,count(*)::int source_count,jsonb_agg(s.fields order by a.started_at,a.id) observations from capture_orders o join capture_order_sources s on s.order_id=o.id join activity_captures a on a.id=s.capture_id and a.deleted_at is null where o.subject_id=${subject} and a.started_at>=${input.date}::date::timestamp at time zone ${input.time_zone} and a.started_at<(${input.date}::date+1)::timestamp at time zone ${input.time_zone} group by o.id order by o.id limit 101`);
 const rules=(await db.execute(sql`select app_package,platform,source_account,enabled,auto_accounting from capture_order_rules where subject_id=${subject} order by app_package limit 100`)).rows;
 const reviewRows=(await db.execute(sql`select *,from_on::text from_on,to_on_exclusive::text to_on_exclusive from capture_reviews where subject_id=${subject} and from_on<=${input.date}::date and to_on_exclusive>${input.date}::date and time_zone=${input.time_zone} order by generated_at desc limit 12`)).rows;
 const reviews=[];
 for(const row of reviewRows){const from=String(row.from_on),to=String(row.to_on_exclusive);let stale=true;try{stale=captureReviewSignature(await captureSnapshot(db,subject,from,to,String(row.time_zone)))!==row.signature;}catch{}
  reviews.push({id:String(row.id),period:String(row.period),from_on:from,to_on_exclusive:to,time_zone:String(row.time_zone),revision:Number(row.revision),stale,body:stale?"来源已变化，请按当前记录重新生成回顾。":String(row.body),source_refs:stale?[]:row.source_refs,source_count:Number(row.source_count),generated_at:iso(row.generated_at)});}
 return {recordings:recordingRows.rows.slice(0,100).map(row=>({id:String(row.id),session_id:String(row.session_id),title:String(row.title),started_at:iso(row.started_at),ended_at:iso(row.ended_at),asset_version_id:String(row.asset_version_id),state:String(row.state),revision:Number(row.revision),attempt:Number(row.attempt),audio_available:row.audio_expired_at===null,protected:Boolean(row.protected),spans:row.spans,error:row.error??null,processor_version:row.processor_version??null})),orders:orderRows.rows.slice(0,100).map(row=>({id:String(row.id),platform:String(row.platform),source_account:String(row.source_account),external_id:String(mergeOrderObservations(row.observations as any).fields.order_id??mergeOrderObservations(row.observations as any).fields.transaction_id??row.external_id),status:mergeOrderObservations(row.observations as any).status,source_count:Number(row.source_count),fields:JSON.stringify(mergeOrderObservations(row.observations as any).fields),record_id:row.record_id??null,conflict:Boolean(row.conflict)||mergeOrderObservations(row.observations as any).conflict})),rules,reviews,recordings_next_before_id:recordingRows.rows.length>100?String(recordingRows.rows[99]!.id):null,truncated:recordingRows.rows.length>100||orderRows.rows.length>100,transcription_available:configuredTranscriber().available};
}
