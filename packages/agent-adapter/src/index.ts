import { z } from "zod";

export const runtimeEventSchema=z.discriminatedUnion("type",[
  z.object({id:z.string().min(1),type:z.literal("run.started"),runId:z.string().min(1)}).strict(),
  z.object({id:z.string().min(1),type:z.literal("message.delta"),runId:z.string().min(1),text:z.string()}).strict(),
  z.object({id:z.string().min(1),type:z.literal("tool.requested"),runId:z.string().min(1),capability:z.string().min(1),input:z.unknown()}).strict(),
  z.object({id:z.string().min(1),type:z.literal("tool.completed"),runId:z.string().min(1),capability:z.string().min(1),result:z.unknown()}).strict(),
  z.object({id:z.string().min(1),type:z.literal("run.completed"),runId:z.string().min(1)}).strict(),
  z.object({id:z.string().min(1),type:z.literal("run.interrupted"),runId:z.string().min(1),reason:z.string().min(1)}).strict()
]);
export type RuntimeEvent=z.infer<typeof runtimeEventSchema>;

export interface RuntimeRequest {
  readonly threadId: string;
  readonly runId: string;
  readonly messageId: string;
  readonly text: string;
  readonly history?: readonly { readonly id:string; readonly role:"user"|"assistant"; readonly content:string; readonly createdAt:string }[];
  readonly personalContext?: { readonly aliases:readonly unknown[]; readonly mealTemplates:readonly unknown[] };
  readonly capabilityProfile: readonly string[];
}

export interface RuntimeToolResult {
  readonly protocol:"shadow.runtime-tool-result";
  readonly threadId:string;
  readonly runId:string;
  readonly toolCallId:string;
  readonly capability:string;
  readonly result:unknown;
}

export interface AgentRuntimeAdapter {
  readonly id: string;
  readonly available: boolean;
  run(request: RuntimeRequest, signal: AbortSignal): AsyncIterable<RuntimeEvent>;
  submitToolResult(request:RuntimeToolResult,signal:AbortSignal):AsyncIterable<RuntimeEvent>;
}

export class UnavailableRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = "unconfigured";
  readonly available = false;
  async *run(request: RuntimeRequest, _signal: AbortSignal): AsyncIterable<RuntimeEvent> {
    yield { id: `${request.runId}:interrupted`, type: "run.interrupted", runId: request.runId, reason: "No verified Agent Runtime is configured." };
  }
  async *submitToolResult(request:RuntimeToolResult,_signal:AbortSignal):AsyncIterable<RuntimeEvent>{yield{id:`${request.runId}:interrupted`,type:"run.interrupted",runId:request.runId,reason:"No verified Agent Runtime is configured."};}
}

export class ScriptedRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = "scripted-test-runtime";
  readonly available = true;
  constructor(private readonly events: readonly RuntimeEvent[],private readonly continuationEvents:readonly RuntimeEvent[]=[]){ }
  async *run(request: RuntimeRequest, signal: AbortSignal): AsyncIterable<RuntimeEvent> {yield* this.emit(this.events,request.runId,signal);}
  async *submitToolResult(request:RuntimeToolResult,signal:AbortSignal):AsyncIterable<RuntimeEvent>{yield* this.emit(this.continuationEvents,request.runId,signal);}
  private async *emit(events:readonly RuntimeEvent[],runId:string,signal:AbortSignal):AsyncIterable<RuntimeEvent>{for(const event of events){if(signal.aborted){yield{id:`${runId}:interrupted`,type:"run.interrupted",runId,reason:"cancelled"};return;}if(event.runId!==runId)throw new Error("Scripted event belongs to another run");yield runtimeEventSchema.parse(event);}}
}

/** Adapter for a runtime gateway with NDJSON start and tool-result continuation endpoints. */
export class HttpRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = "http-runtime";
  readonly available = true;
  constructor(private readonly options: { url: string; token?: string; continuationUrl?:string }) {}
  run(request: RuntimeRequest, signal: AbortSignal): AsyncIterable<RuntimeEvent> {return this.post(this.options.url,request,request.runId,signal);}
  submitToolResult(request:RuntimeToolResult,signal:AbortSignal):AsyncIterable<RuntimeEvent>{return this.post(this.options.continuationUrl??`${this.options.url.replace(/\/$/u,"")}/tool-results`,request,request.runId,signal);}
  private async *post(url:string,body:unknown,runId:string,signal:AbortSignal):AsyncIterable<RuntimeEvent>{
    const response=await fetch(url,{method:"POST",signal,headers:{"content-type":"application/json","accept":"application/x-ndjson",...(this.options.token?{authorization:`Bearer ${this.options.token}`}:{})},body:JSON.stringify(body)});
    if(!response.ok||!response.body)throw new Error(`Runtime gateway failed with HTTP ${response.status}`);
    const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let pending="";
    while(true){const{value,done}=await reader.read();pending+=value??"";const lines=pending.split("\n");pending=lines.pop()??"";for(const line of lines)if(line.trim())yield validateEvent(JSON.parse(line),runId);if(done)break;}
    if(pending.trim())yield validateEvent(JSON.parse(pending),runId);
  }
}

function validateEvent(value:unknown,runId:string):RuntimeEvent{const event=runtimeEventSchema.parse(value);if(event.runId!==runId)throw new Error("Runtime event belongs to another run");return event;}
