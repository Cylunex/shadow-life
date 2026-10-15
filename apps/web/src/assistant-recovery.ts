import { runPageResultSchema, threadRunsResultSchema } from "@shadow/contracts";
import { applyAssistantEvent,createAssistantView,type AssistantView } from "./assistant-stream.js";

export type ObservationState="observing"|"reconnecting"|"finished";
type Options={fetcher:typeof fetch;headers:HeadersInit;signal:AbortSignal;onUpdate:(state:ObservationState)=>void;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;hidden?:()=>boolean};

export class ObservationUnavailable extends Error {}
async function read(url:string,options:Options){
  const controller=new AbortController(),cancel=()=>controller.abort();
  options.signal.addEventListener("abort",cancel,{once:true});if(options.signal.aborted)cancel();
  const timer=setTimeout(cancel,10000);
  try{
    const fetcher=options.fetcher,response=await fetcher(url,{headers:options.headers,signal:controller.signal});
    if([401,403,404].includes(response.status))throw new ObservationUnavailable("该运行已不可见或登录已失效。");
    if(!response.ok)throw new Error(`运行读取失败（HTTP ${response.status}）`);
    return await response.json();
  }finally{clearTimeout(timer);options.signal.removeEventListener("abort",cancel);}
}
export async function discoverAssistantRun(threadId:string,options:Options){
  let failures=0;
  while(!options.signal.aborted){
    try{return threadRunsResultSchema.parse(await read(`/api/threads/${encodeURIComponent(threadId)}/runs`,options)).items[0];}
    catch(error){if(options.signal.aborted)return;if(error instanceof ObservationUnavailable)throw error;options.onUpdate("reconnecting");await (options.wait??waitForObservation)(options.hidden?.()?15000:Math.min(8000,1000*2**Math.min(failures++,3)),options.signal);}
  }
}

// Observation only: no user message, Runtime start, or business write is ever retried here.
export async function observeAssistantRun(view:AssistantView,options:Options):Promise<void>{
  if(!view.runId)throw new Error("缺少运行标识");let failures=0,sawRunning=false,terminalReplayed=false;
  // Rebuild after transport loss instead of retaining source payloads which have
  // not passed the server's current visibility checks. Only identifiers survive.
  Object.assign(view,createAssistantView(view.runId));options.onUpdate("observing");
  while(!options.signal.aborted){
    try{
      const before=view.lastSequence;
      const page=runPageResultSchema.parse(await read(`/api/runs/${encodeURIComponent(view.runId)}?after=${before}&limit=100`,options));
      if(options.signal.aborted)return;
      if(page.run.id!==view.runId)throw new ObservationUnavailable("运行标识不匹配");
      if(page.run.status==="running")sawRunning=true;
      for(const event of page.events)applyAssistantEvent(view,event.payload,event.sequence);
      if(page.next_after!==view.lastSequence||view.hasGap)throw new Error("事件日志不连续，正在从已确认位置补读。");
      // A terminal SSE event may precede transaction completion and receipt recovery.
      // Drain the durable high-water mark before accepting the database terminal state.
      if(page.run.status!=="running"&&!page.has_more&&view.lastSequence>=page.run.last_sequence){
        if(sawRunning&&!terminalReplayed){terminalReplayed=true;Object.assign(view,createAssistantView(view.runId));options.onUpdate("observing");continue;}
        view.state=page.run.status==="failed"?"interrupted":page.run.status;
        if(page.run.error)view.reason=page.run.error;
        options.onUpdate("finished");return;
      }
      options.onUpdate("observing");failures=0;
      if(page.has_more&&view.lastSequence>before)continue;
    }catch(error){
      if(options.signal.aborted)return;
      if(error instanceof ObservationUnavailable)throw error;
      options.onUpdate("reconnecting");failures++;
    }
    await (options.wait??waitForObservation)(options.hidden?.()?15000:Math.min(8000,1000*2**Math.min(failures,3)),options.signal);
  }
}

export function waitForObservation(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.resolve();
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener("abort",finish);globalThis.removeEventListener?.("online",finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener("abort",finish,{once:true});globalThis.addEventListener?.("online",finish,{once:true});
  });
}
