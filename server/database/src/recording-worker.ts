import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { transcriptConfigSchema,transcriptResponseSchema,type TranscriptConfig,type TranscriptSpans,completeRecordingSchema } from "@shadow/contracts";
import { CommandExecutor,KernelError,sha256Fingerprinter,systemClock,uuidIds,type RequestContext } from "@shadow/kernel";
import { PostgresUnitOfWork } from "./postgres.js";
export type Transcriber={available:boolean;process(bytes:Buffer,mediaType:string,durationMs:number):Promise<{processor_version:string;spans:TranscriptSpans}>};
export function configuredTranscriber(path=process.env.SHADOW_TRANSCRIPT_CONFIG_FILE):Transcriber{
 let config:TranscriptConfig|undefined;
 try{if(path){config=transcriptConfigSchema.parse(JSON.parse(readFileSync(path,"utf8")));if(config.token_file&&!readFileSync(config.token_file,"utf8").trim())throw new Error("Token file empty");const url=new URL(config.url);if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname)))config=undefined;}}catch{config=undefined;}
 return {available:Boolean(config),async process(bytes,mediaType,durationMs){
  if(!config)throw new Error("录音转写处理器尚未配置或配置无效");
  const token=config.token_file?readFileSync(config.token_file,"utf8").trim():null;
  const form=new FormData();form.set("model",config.model);form.set("response_format","verbose_json");form.append("timestamp_granularities[]","segment");if(config.language)form.set("language",config.language);
  form.set("file",new Blob([Uint8Array.from(bytes)],{type:mediaType}),mediaType==='audio/mp4'?"segment.m4a":mediaType==='audio/wav'?"segment.wav":"segment.audio");
  const response=await fetch(config.url,{method:"POST",redirect:"error",headers:token?{authorization:`Bearer ${token}`}:{},body:form,signal:AbortSignal.timeout(config.timeout_ms)});
  if(!response.ok)throw new Error(`录音转写服务返回 HTTP ${response.status}`);
  const chunks:Uint8Array[]=[];let size=0;if(!response.body)throw new Error("转写服务未返回正文");
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>1000000)throw new Error("转写结果超过限制");chunks.push(chunk);}
  const raw=transcriptResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const spans=raw.segments.filter(s=>s.text.trim()).map(s=>({start_ms:Math.round(s.start*1000),end_ms:Math.round(s.end*1000),text:s.text.trim(),speaker:s.speaker??null}));
  if(spans.some(s=>s.end_ms>durationMs||s.end_ms<=s.start_ms)||spans.some((s,i)=>i>0&&s.start_ms<spans[i-1]!.end_ms))throw new Error("转写时间戳不在音频范围内或顺序错误");
  completeRecordingSchema.shape.spans.parse(spans);
  return {processor_version:`openai-compatible:${config.model}`.slice(0,100),spans};
 }};
}
export async function processPendingRecordings(pool:Pool,limit=10,processor:Transcriber=configuredTranscriber()){
 if(!processor.available)return [];
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError("Recording worker limit must be 1–100");
 const rows=await pool.query("select id,subject_id,attempt from capture_recording_segments where deleted_at is null and (state='queued' or (state='running' and lease_expires_at<=clock_timestamp())) order by started_at,id limit $1",[limit]);
 const executor=new CommandExecutor({unitOfWork:new PostgresUnitOfWork(pool),ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter});const outcomes=[];
 for(const candidate of rows.rows){
  const context:RequestContext={actorId:candidate.subject_id,subjectId:candidate.subject_id,clientId:"worker_recording",traceId:uuidIds.next("event"),effects:new Set(["library.processor.write"])};
  const execute=(capability:string,input:unknown)=>executor.execute(context,{protocol:"shadow.command",command_id:`cmd_${crypto.randomUUID()}`,capability,input});let attempt:number;
  try{attempt=Number((await execute("life.claim_recording",{segment_id:candidate.id,expected_attempt:candidate.attempt})).actual_values.attempt);}catch(e){if(e instanceof KernelError&&e.status===409)continue;throw e;}
  try{
   const row=(await pool.query("select r.*,b.bytes,a.media_type from capture_recording_segments r join asset_versions v on v.id=r.asset_version_id join assets a on a.id=v.asset_id and a.subject_id=r.subject_id join asset_blobs b on b.asset_version_id=v.id where r.id=$1 and r.subject_id=$2 and r.deleted_at is null",[candidate.id,candidate.subject_id])).rows[0];if(!row)throw new Error("音频已不可用");
   const result=await processor.process(row.bytes,row.media_type,new Date(row.ended_at).getTime()-new Date(row.started_at).getTime());
   await execute("life.complete_recording",{segment_id:candidate.id,attempt,...result});outcomes.push({id:candidate.id,state:"completed"});
  }catch(error){
   try{await execute("life.fail_recording",{segment_id:candidate.id,attempt,message:error instanceof Error&&error.message.startsWith("录音转写")?error.message:"转写失败，请检查处理器配置或音频后重试"});outcomes.push({id:candidate.id,state:"failed"});}catch(e){if(!(e instanceof KernelError&&e.status===409))throw e;outcomes.push({id:candidate.id,state:"superseded"});}
  }
 }
 return outcomes;
}
