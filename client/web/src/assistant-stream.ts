import { hostRunEventSchema, foundationQueries } from "@shadow/contracts";
import { agentContextResultSchema, type AgentContextResult } from "@shadow/contracts";
export type AssistantRunState="started"|"streaming"|"awaiting_input"|"committed_partial"|"completed"|"interrupted";

export interface AssistantView {
  runId?:string|undefined;
  hasGap:boolean;
  activities:Map<string,{label:string;state:"running"|"completed"|"rejected"}>;
  state?:AssistantRunState;
  answer:string;
  prompt?:string;
  reason?:string;
  receipts:Map<string,string>;
  lastSequence:number;
  contextQueries:Map<string,AgentContextResult>;
  contextUnavailable:boolean;
  foundationQueries:Map<string,{capability:string;result:any}>;
}

export function createAssistantView(runId?:string):AssistantView{return{runId,hasGap:false,activities:new Map(),answer:"",receipts:new Map(),foundationQueries:new Map(),contextQueries:new Map(),contextUnavailable:false,lastSequence:0};}

export function applyAssistantEvent(view:AssistantView,value:unknown,sequence=0):void{
  const parsed=hostRunEventSchema.safeParse(value);if(!parsed.success)return;
  const event=parsed.data,type=event.type;
  if(view.runId&&event.run_id!==view.runId)return;
  if(!Number.isSafeInteger(sequence)||sequence<1)return;
  view.runId??=event.run_id;
  // A source revoked during recovery must disappear even if its original event was seen.
  if(type==="tool.result"&&event.outcome==="rejected"){
    const key=`${event.run_id}:${event.tool_call_id}`;view.foundationQueries.delete(key);view.contextQueries.delete(key);
    if(event.capability in foundationQueries||event.capability==="agent.context")view.contextUnavailable=true;
  }
  if(sequence<=view.lastSequence)return;
  if(sequence!==view.lastSequence+1){view.hasGap=true;return;}
  view.lastSequence=sequence;view.hasGap=false;
  if(type==="tool.started"){
    view.activities.set(event.tool_call_id,{label:event.mode==="read"?"读取资料中":"正在保存",state:"running"});return;
  }
  if(type==="tool.result"&&event.authority==="host")view.activities.set(event.tool_call_id,{label:event.outcome==="returned"?"已读取相关记录":"操作未完成",state:event.outcome==="returned"?"completed":"rejected"});
  if(type==="tool.result"&&event.authority==="host"&&typeof event.capability==="string"&&event.capability in foundationQueries&&typeof event.tool_call_id==="string"){
    const key=`${String(event.run_id)}:${event.tool_call_id}`;
    if(event.outcome==="returned"){const parsed=foundationQueries[event.capability as keyof typeof foundationQueries].result.safeParse(event.result);if(parsed.success)view.foundationQueries.set(key,{capability:event.capability,result:parsed.data});}
    else{view.foundationQueries.delete(key);view.contextUnavailable=true;}
    return;
  }
  if(type==="tool.result"&&event.authority==="host"&&event.capability==="agent.context"&&typeof event.tool_call_id==="string"){
    const key=`${String(event.run_id)}:${event.tool_call_id}`;
    if(event.outcome==="returned"){
      const parsed=agentContextResultSchema.safeParse(event.result);
      if(parsed.success)view.contextQueries.set(key,parsed.data);
    }else{
      view.contextQueries.delete(key);
      const error=event.result as {code?:unknown}|undefined;
      if(error?.code==="not_found"||error?.code==="permission_denied")view.contextUnavailable=true;
    }
    return;
  }
  if(type==="message.delta"&&typeof event.text==="string"){view.answer+=event.text;return;}
  if(type==="run.state"&&isRunState(event.state)){
    view.state=event.state;
    if(typeof event.reason==="string")view.reason=event.reason;
    if(typeof event.prompt==="string")view.prompt=event.prompt;
    return;
  }
  if(type!=="operation.committed"||event.authority!=="executor"||typeof event.execution_id!=="string")return;
  const result=event.result;
  if(result===null||typeof result!=="object")return;
  const operation=result as Record<string,unknown>;
  if(operation.protocol!=="shadow.execution-result"||operation.status!=="committed"||operation.execution_id!==event.execution_id)return;
  view.receipts.set(event.execution_id,`已保存：${event.execution_id}`);
  view.activities.set(event.tool_call_id,{label:"已保存 1 项",state:"completed"});
}

export function renderAssistantView(view:AssistantView):string{
  const parts=[view.answer.trim(),...view.receipts.values()].filter(Boolean);
  if(view.state==="awaiting_input")return[view.prompt||view.answer.trim()||"请补充必要信息。",...view.receipts.values()].filter(Boolean).join("\n");
  if(view.state==="completed")return parts.join("\n")||"运行已完成，但没有返回可核验的结果。";
  if(view.state==="interrupted")return[`未完成：${view.reason??"运行已中断"}`,...parts].join("\n");
  return parts.join("\n");
}

export async function readAssistantSse(body:ReadableStream<Uint8Array>,onEvent:(event:unknown,sequence:number)=>void,signal?:AbortSignal):Promise<void>{
  const reader=body.getReader(),decoder=new TextDecoder();let pending="",eventId=0,data:string[]=[];
  const abort=()=>{void reader.cancel();};signal?.addEventListener("abort",abort,{once:true});
  const consumeLine=(line:string)=>{
    if(line===""){if(data.length){let value:unknown;try{value=JSON.parse(data.join("\n"));}catch{data=[];return;}onEvent(value,eventId);}data=[];return;}
    if(line.startsWith("id:")){const value=Number(line.slice(3).trim());eventId=Number.isSafeInteger(value)&&value>0?value:0;}
    else if(line.startsWith("data:"))data.push(line.slice(5).trimStart());
  };
  try{while(!signal?.aborted){
    const timer=setTimeout(()=>void reader.cancel(),15000);
    let part:ReadableStreamReadResult<Uint8Array>;try{part=await reader.read();}finally{clearTimeout(timer);}
    pending+=decoder.decode(part.value,{stream:!part.done});if(pending.length>2*1024*1024)throw new Error("事件流帧超过上限");
    const lines=pending.split("\n");pending=lines.pop()??"";for(const line of lines){if(signal?.aborted)break;consumeLine(line.replace(/\r$/u,""));}if(part.done)break;
  }}finally{signal?.removeEventListener("abort",abort);reader.releaseLock();}
  // An incomplete frame is deliberately discarded; the authoritative log supplies it.
}

function isRunState(value:unknown):value is AssistantRunState{return value==="started"||value==="streaming"||value==="awaiting_input"||value==="committed_partial"||value==="completed"||value==="interrupted";}
