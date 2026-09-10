import { randomUUID } from "node:crypto";
import { CommandExecutor, KernelError, sha256Fingerprinter, systemClock, uuidIds, type RequestContext } from "@shadow/kernel";
import { PostgresUnitOfWork } from "./postgres.js";
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

export async function processPendingLibrary(pool:Pool,limit=20):Promise<Array<{job_id:string;state:"completed"|"failed"|"superseded";error?:string}>>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError("library processing limit must be between 1 and 100");
  // Reading candidates grants no ownership. Claim each immediately before doing its work;
  // simultaneous dispatchers resolve their race in the same public Executor transaction.
  const candidates=await pool.query<{id:string;subject_id:string;source_asset_version_id:string;attempts:number}>("select id,subject_id,source_asset_version_id,attempts from library_processing_jobs where kind='text_extract' and requested_processor='builtin-text-v1' and (state='queued' or (state='running' and lease_expires_at<=clock_timestamp())) order by updated_at,id limit $1",[limit]);
  const executor=new CommandExecutor({unitOfWork:new PostgresUnitOfWork(pool),ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter});
  const assets=new AssetService(pool),results:Array<{job_id:string;state:"completed"|"failed"|"superseded";error?:string}>=[];
  for(const job of candidates.rows){
    const context:RequestContext={actorId:job.subject_id,subjectId:job.subject_id,clientId:"worker_library_builtin",traceId:`trace_${randomUUID()}`,effects:new Set(["library.processor.write"])};
    const execute=(capability:string,input:unknown)=>executor.execute(context,{protocol:"shadow.command",capability,command_id:`cmd_${randomUUID()}`,input});
    let attempt:number;
    try{
      const claimed=await execute("library.claim_processing",{job_id:job.id,expected_attempt:job.attempts});
      attempt=Number(claimed.actual_values.attempt);
    }catch(error){if(error instanceof KernelError&&error.status===409)continue;throw error;}
    try{
      const source=(await pool.query<{bytes:Buffer;media_type:string}>("select blob.bytes,asset.media_type from asset_blobs blob join asset_versions version on version.id=blob.asset_version_id join assets asset on asset.id=version.asset_id where version.id=$1 and asset.subject_id=$2",[job.source_asset_version_id,job.subject_id])).rows[0];
      if(!source)throw new Error("fixed original asset is unavailable");
      if(!textMediaTypes.has(source.media_type))throw new Error(`builtin-text-v1 does not support ${source.media_type}`);
      if(source.bytes.length>1_000_000)throw new Error("text original exceeds the 1000000 byte processing limit");
      const text=new TextDecoder("utf-8",{fatal:true}).decode(source.bytes),snippets=splitLibraryText(text);
      if(!snippets.length)throw new Error("text original contains no readable content");
      const derived=await assets.store(job.subject_id,"text/plain",Buffer.from(text,"utf8"),{sourceVersionId:job.source_asset_version_id,processor:"builtin-text-v1",kind:"text_extract"});
      await execute("library.complete_processing",{job_id:job.id,attempt,derived_asset_version_id:derived.asset_version_id,processor_version:"builtin-text-v1",snippets});
      results.push({job_id:job.id,state:"completed"});
    }catch(error){
      const message=(error instanceof Error?error.message:"library processing failed").slice(0,2_000);
      try{
        // The Executor fences this failure too: a delayed worker cannot damage a new
        // attempt or turn an already committed success into failure after a lost reply.
        await execute("library.fail_processing",{job_id:job.id,attempt,error:message});
        results.push({job_id:job.id,state:"failed",error:message});
      }catch(failure){
        if(!(failure instanceof KernelError&&failure.status===409))throw failure;
        results.push({job_id:job.id,state:"superseded"});
      }
    }
  }
  return results;
}
