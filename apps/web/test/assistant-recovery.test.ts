import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantEvent,createAssistantView } from "../src/assistant-stream.js";
import { discoverAssistantRun,observeAssistantRun } from "../src/assistant-recovery.js";

const delta=(run:string,text:string)=>({id:`${run}:${text}`,run_id:run,type:"message.delta",text,runtime_event_id:text});
test("run projection deduplicates overlaps and never jumps over gaps or foreign runs",()=>{
  const view=createAssistantView("run_expected");
  applyAssistantEvent(view,delta("run_expected","三"),3);
  assert.equal(view.lastSequence,0);assert.equal(view.answer,"");
  applyAssistantEvent(view,delta("run_expected","一"),1);
  applyAssistantEvent(view,delta("run_expected","一"),1);
  applyAssistantEvent(view,delta("run_foreign","泄漏"),2);
  applyAssistantEvent(view,{type:"message.delta",run_id:"run_expected",text:42},2);
  assert.equal(view.lastSequence,1);
  applyAssistantEvent(view,delta("run_expected","二"),2);
  applyAssistantEvent(view,delta("run_expected","三"),3);
  assert.equal(view.answer,"一二三");assert.equal(view.lastSequence,3);
});

const run=(status="completed",last=452)=>({id:"run_expected",thread_id:"thread_expected",status,error:null,started_at:"2026-10-15T00:00:00Z",finished_at:status==="running"?null:"2026-10-15T00:01:00Z",last_sequence:last});
const row=(sequence:number,payload:unknown=delta("run_expected",`${sequence},`))=>({sequence,event_type:(payload as {type:string}).type,payload,created_at:"2026-10-15T00:00:01Z"});
test("recovery drains multiple pages past terminal SSE and the last receipt without any POST",async()=>{
  const view=createAssistantView("run_expected"),requests:string[]=[],events=Array.from({length:450},(_,index)=>row(index+1));
  events.push(row(451,{id:"done",type:"run.state",run_id:"run_expected",state:"completed"}));
  events.push(row(452,{id:"receipt",type:"operation.committed",authority:"executor",run_id:"run_expected",execution_id:"execution_real",subject_id:"subject_real",tool_call_id:"call_real",capability:"library.capture",command_id:"cmd_real",result:{protocol:"shadow.execution-result",status:"committed",execution_id:"execution_real"}}));
  applyAssistantEvent(view,delta("run_expected","old SSE"),1);
  const fetcher=(async function(this:unknown,input:string|URL|Request,init?:RequestInit){assert.equal(this,undefined);assert.equal(init?.method,undefined);const url=new URL(String(input),"https://example.com");requests.push(url.href);const after=Number(url.searchParams.get("after")),page=events.filter(event=>event.sequence>after).slice(0,100),next=page.at(-1)?.sequence??after;return Response.json({run:run(),events:page,next_after:next,has_more:next<452});}) as typeof fetch;
  await observeAssistantRun(view,{fetcher,headers:{},signal:new AbortController().signal,onUpdate:()=>{},wait:async()=>{}});
  assert.equal(view.lastSequence,452);assert.equal(view.state,"completed");assert.equal(view.receipts.size,1);assert.equal(view.answer,Array.from({length:450},(_,index)=>`${index+1},`).join(""));assert.equal(requests.length,5);assert.match(requests[0]!,/after=0/);
});
test("recovery retries read exceptions and gaps from the contiguous cursor, then revalidates the terminal replay",async()=>{
  const view=createAssistantView("run_expected"),after:number[]=[],states:string[]=[];let calls=0;
  const fetcher=(async(input:string|URL|Request)=>{
    after.push(Number(new URL(String(input),"https://example.com").searchParams.get("after")));
    if(++calls===1)throw new TypeError("offline");
    if(calls===2)return Response.json({run:run("running",3),events:[row(1),row(3)],next_after:3,has_more:false});
    const start=calls===3?2:1;
    return Response.json({run:run("completed",3),events:[row(start),...(start===1?[row(2)]:[]),row(3)],next_after:3,has_more:false});
  }) as typeof fetch;
  await observeAssistantRun(view,{fetcher,headers:{},signal:new AbortController().signal,onUpdate:state=>states.push(state),wait:async()=>{}});
  assert.deepEqual(after,[0,0,1,0]);assert.equal(view.answer,"1,2,3,");assert.ok(states.includes("reconnecting"));assert.equal(states.at(-1),"finished");
});
test("refresh discovers only server-owned run IDs; canceled scopes cannot publish late results",async()=>{
  const controller=new AbortController(),states:string[]=[],view=createAssistantView("run_expected");
  const found=await discoverAssistantRun("thread_expected",{fetcher:(async()=>Response.json({items:[run("running",1)]})) as typeof fetch,headers:{},signal:controller.signal,onUpdate:()=>{}});
  assert.equal(found?.id,"run_expected");
  let finish!:(value:Response)=>void;const response=new Promise<Response>(resolve=>{finish=resolve;});
  const observing=observeAssistantRun(view,{fetcher:(async()=>response) as typeof fetch,headers:{},signal:controller.signal,onUpdate:state=>states.push(state),wait:async()=>{}});
  controller.abort();finish(Response.json({run:run("completed",1),events:[row(1)],next_after:1,has_more:false}));await observing;
  assert.equal(view.answer,"");assert.equal(states.includes("finished"),false);
});
