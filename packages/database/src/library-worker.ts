import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AssetService } from "./asset-service.js";

const textMediaTypes=new Set(["text/plain","text/markdown","application/json"]);

export function splitLibraryText(text:string,maxCharacters=4_000):Array<{text:string;locator:{start:number;end:number}}>{
  const normalized=text.replaceAll("\r\n","\n").trim();if(!normalized)return[];
  const snippets:Array<{text:string;locator:{start:number;end:number}}>=[];let start=0;
  while(start<normalized.length&&snippets.length<500){let end=Math.min(start+maxCharacters,normalized.length);if(end<normalized.length){const boundary=normalized.lastIndexOf("\n",end);if(boundary>start)end=boundary;}const value=normalized.slice(start,end).trim();if(value)snippets.push({text:value,locator:{start,end}});start=end;while(normalized[start]==="\n")start++;}
  if(start<normalized.length)throw new Error("extracted text exceeds the 500 snippet limit");
  return snippets;
}

export async function processPendingLibrary(pool:Pool,limit=20):Promise<Array<{job_id:string;state:"completed"|"failed";error?:string}>>{
  const claimed=await pool.query<{id:string;item_id:string;subject_id:string;source_asset_version_id:string}>("with candidates as (select id from library_processing_jobs where kind='text_extract' and requested_processor='builtin-text-v1' and (state='queued' or (state='running' and updated_at<now()-interval '5 minutes')) order by updated_at,id for update skip locked limit $1) update library_processing_jobs job set state='running',attempts=attempts+1,started_at=coalesce(started_at,now()),updated_at=now() from candidates where job.id=candidates.id returning job.id,job.item_id,job.subject_id,job.source_asset_version_id",[limit]);
  const assets=new AssetService(pool),results:Array<{job_id:string;state:"completed"|"failed";error?:string}>=[];
  for(const job of claimed.rows){try{
    const source=(await pool.query<{bytes:Buffer;media_type:string}>("select blob.bytes,asset.media_type from asset_blobs blob join asset_versions version on version.id=blob.asset_version_id join assets asset on asset.id=version.asset_id where version.id=$1 and asset.subject_id=$2",[job.source_asset_version_id,job.subject_id])).rows[0];
    if(!source)throw new Error("fixed original asset is unavailable");if(!textMediaTypes.has(source.media_type))throw new Error(`builtin-text-v1 does not support ${source.media_type}`);if(source.bytes.length>1_000_000)throw new Error("text original exceeds the 1000000 byte processing limit");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(source.bytes),snippets=splitLibraryText(text);if(!snippets.length)throw new Error("text original contains no readable content");const derived=await assets.store(job.subject_id,"text/plain",Buffer.from(text,"utf8"),{sourceVersionId:job.source_asset_version_id,processor:"builtin-text-v1",kind:"text_extract"});
    const client=await pool.connect();try{await client.query("begin");const locked=await client.query<{revision:number}>("select item.current_revision revision from library_processing_jobs job join library_items item on item.id=job.item_id and item.subject_id=job.subject_id where job.id=$1 and job.subject_id=$2 and job.state='running' for update",[job.id,job.subject_id]);if(!locked.rowCount)throw new Error("processing job is no longer running");const revision=locked.rows[0]!.revision,short=createHash("sha256").update(job.id).digest("hex").slice(0,24),derivationId=`derivation_${short}`;await client.query("insert into library_derivations(id,item_id,subject_id,source_asset_version_id,derived_asset_version_id,kind,processor_version) values($1,$2,$3,$4,$5,'text_extract','builtin-text-v1')",[derivationId,job.item_id,job.subject_id,job.source_asset_version_id,derived.asset_version_id]);for(const [ordinal,snippet] of snippets.entries())await client.query("insert into library_snippets(id,item_id,job_id,subject_id,item_revision,ordinal,text,locator) values($1,$2,$3,$4,$5,$6,$7,$8)",[`snippet_${short}_${ordinal}`,job.item_id,job.id,job.subject_id,revision,ordinal,snippet.text,snippet.locator]);await client.query("update library_processing_jobs set state='completed',derived_asset_version_id=$2,processor_version='builtin-text-v1',last_error=null,finished_at=now(),updated_at=now() where id=$1",[job.id,derived.asset_version_id]);await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}results.push({job_id:job.id,state:"completed"});
  }catch(error){const message=error instanceof Error?error.message:"library processing failed";await pool.query("update library_processing_jobs set state='failed',last_error=$2,finished_at=now(),updated_at=now() where id=$1",[job.id,message]);results.push({job_id:job.id,state:"failed",error:message});}}
  return results;
}
