export type AssistantRunState="started"|"streaming"|"awaiting_input"|"committed_partial"|"completed"|"interrupted";

export interface AssistantView {
  runId?:string;
  state?:AssistantRunState;
  answer:string;
  prompt?:string;
  reason?:string;
  receipts:Map<string,string>;
  lastSequence:number;
}

export function createAssistantView():AssistantView{return{answer:"",receipts:new Map(),lastSequence:0};}

export function applyAssistantEvent(view:AssistantView,value:unknown,sequence=0):void{
  if(value===null||typeof value!=="object")return;
  const event=value as Record<string,unknown>,type=event.type;
  if(typeof event.run_id==="string")view.runId=event.run_id;
  if(Number.isInteger(sequence)&&sequence>view.lastSequence)view.lastSequence=sequence;
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
}

export function renderAssistantView(view:AssistantView):string{
  const parts=[view.answer.trim(),...view.receipts.values()].filter(Boolean);
  if(view.state==="awaiting_input")return[view.prompt||view.answer.trim()||"请补充必要信息。",...view.receipts.values()].filter(Boolean).join("\n");
  if(view.state==="completed")return parts.join("\n")||"运行已完成，但没有返回可核验的结果。";
  if(view.state==="interrupted")return[`未完成：${view.reason??"运行已中断"}`,...parts].join("\n");
  return["连接已中断，运行结果尚未确认。",...parts].join("\n");
}

export async function readAssistantSse(body:ReadableStream<Uint8Array>,onEvent:(event:unknown,sequence:number)=>void):Promise<void>{
  const reader=body.getReader(),decoder=new TextDecoder();let pending="",eventId=0;
  const consumeLine=(line:string)=>{if(line.startsWith("id:")){const value=Number(line.slice(3).trim());if(Number.isInteger(value)&&value>=0)eventId=value;return;}if(!line.startsWith("data:"))return;try{onEvent(JSON.parse(line.slice(5).trim()),eventId);}catch{/* malformed transport data is not a fact */}};
  while(true){const{value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});const lines=pending.split("\n");pending=lines.pop()??"";for(const line of lines)consumeLine(line.replace(/\r$/u,""));if(done)break;}
  if(pending)consumeLine(pending.replace(/\r$/u,""));
}

function isRunState(value:unknown):value is AssistantRunState{return value==="started"||value==="streaming"||value==="awaiting_input"||value==="committed_partial"||value==="completed"||value==="interrupted";}
