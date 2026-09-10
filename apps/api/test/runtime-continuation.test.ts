import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeAdapter, RuntimeRequest, RuntimeToolResult } from "@shadow/agent-adapter";
import { notFound } from "@shadow/kernel";
import { createApp } from "../src/app.js";

test("agent query result is returned to the runtime before the final answer",async()=>{
  let submitted:RuntimeToolResult|undefined,started:RuntimeRequest|undefined,sequence=0;
  const runtime:AgentRuntimeAdapter={id:"test",available:true,async *run(request:RuntimeRequest){started=request;yield{id:"tool_1",type:"tool.requested",runId:request.runId,capability:"money.summarize",input:{}};},async *submitToolResult(request){submitted=request;yield{id:"delta_1",type:"message.delta",runId:request.runId,text:"净支出为 80 元"};yield{id:"done_1",type:"run.completed",runId:request.runId};}};
  const dependencies={
    unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},
    executor:{execute:async()=>{throw new Error("query must not enter write executor");},getOperation:async()=>({})},
    queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]}),listMeals:async()=>[],summarizeMoney:async()=>({currency:"CNY",expense_total:"100.00",entries:3,as_of:"2026-09-08T00:00:00.000Z",totals:[{currency:"CNY",gross_expense:"100",refund:"20",net_spending:"80",income:"0",net_cashflow:"-80",entries:3}]})},
    developmentAuth:true,
    agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[{id:"message_old",role:"user",content:"午饭 18 元",createdAt:"2026-09-08T00:00:00Z"}],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async()=>undefined},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}
  } as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"最近花了多少？"})});
  const body=await response.text();
  assert.equal(response.status,200);assert.equal(started?.history?.[0]?.content,"午饭 18 元");assert.deepEqual(started?.personalContext,{aliases:[],mealTemplates:[],memories:[]});assert.equal(submitted?.capability,"money.summarize");assert.deepEqual((submitted?.result as {totals:unknown[]}).totals[0],{currency:"CNY",gross_expense:"100",refund:"20",net_spending:"80",income:"0",net_cashflow:"-80",entries:3});assert.match(body,/净支出为 80 元/u);
});

test("a context pack is rechecked before the user message enters a run",async()=>{
  let started:RuntimeRequest|undefined,added=0;const runtime:AgentRuntimeAdapter={id:"context",available:true,async *run(request){started=request;yield{id:"done",type:"run.completed",runId:request.runId};},async *submitToolResult(){throw new Error("unused");}},pack={id:"context_pack_12345678",thread_id:"thread_00000001",object_refs:[{kind:"library_item",id:"library_12345678",revision:1}]};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{agentContextPack:async()=>pack,agentPersonalContext:async()=>({aliases:[],mealTemplates:[]}),agentMemories:async()=>({items:[{category:"explicit_preference",memory_key:"tone"}]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>{added++;},conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>1,finishRun:async()=>undefined},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"解释这个对象",context_pack_id:pack.id})});await response.text();assert.equal(response.status,200);assert.deepEqual(started?.contextPack,pack);assert.deepEqual(started?.personalContext?.memories,[{category:"explicit_preference",memory_key:"tone"}]);assert.equal(added,1);
  dependencies.queries.agentContextPack=async()=>{throw notFound("context pack");};const rejected=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"不应写入",context_pack_id:"context_pack_missing0"})});assert.equal(rejected.status,404);assert.equal(added,1);
});

test("missing tool facts return to the runtime so it can ask one follow-up",async()=>{
  let submitted:RuntimeToolResult|undefined,sequence=0;
  const runtime:AgentRuntimeAdapter={id:"test",available:true,async *run(request){yield{id:"tool_missing",type:"tool.requested",runId:request.runId,capability:"money.planning",input:{}};},async *submitToolResult(request){submitted=request;yield{id:"ask_1",type:"message.delta",runId:request.runId,text:"要查看哪个月份？"};yield{id:"done_1",type:"run.completed",runId:request.runId};}};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async()=>undefined},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"看下预算"})});const body=await response.text();
  assert.equal(response.status,200);assert.equal((submitted?.result as {code:string}).code,"missing_fact");assert.deepEqual((submitted?.result as {fields:string[]}).fields,["period"]);assert.match(body,/要查看哪个月份/u);
});

test("missing resources are returned as 404 errors",async()=>{
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{lifeRecord:async()=>{throw notFound("life record");}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/life/records/missing_record",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,404);assert.equal((await response.json() as {code:string}).code,"not_found");
});

test("overview routes parse typed filters before calling query services",async()=>{
  let todayInput:unknown,timelineInput:unknown,importBatchId="",healthRecordId="",travelWorkspaceInput:unknown,travelExportInput:unknown,travelPreviewInput:unknown,ownedItemsInput:unknown,reviewsInput:unknown;
  const dependencies={
    unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},
    executor:{execute:async()=>({}),getOperation:async()=>({})},
    queries:{
      lifeToday:async(_context:unknown,input:unknown)=>{todayInput=input;return{date:"2026-09-10",time_zone:"Asia/Shanghai",domains:{money:{entries:1,totals:[],freshness:"2026-09-10T01:00:00.000Z"}},as_of:"2026-09-10T02:00:00.000Z"};},
      lifeTimeline:async(_context:unknown,input:unknown)=>{timelineInput=input;return{items:[],next_cursor:null,as_of:"2026-09-10T02:00:00.000Z"};},
      moneyImportReview:async(_context:unknown,batchId:string)=>{importBatchId=batchId;return{batch:{id:batchId},candidates:[]};},
      healthRecord:async(_context:unknown,id:string)=>{healthRecordId=id;return{kind:"measurement",fact:{id}};},
      travelWorkspace:async(_context:unknown,input:unknown)=>{travelWorkspaceInput=input;return{places:[],maps:[],trips:[]};},
      travelExport:async(_context:unknown,input:unknown)=>{travelExportInput=input;return{format:"ics",mime_type:"text/calendar",filename:"trip_demo.ics",sha256:"0".repeat(64),content:"BEGIN:VCALENDAR"};}
      ,previewTravelPortable:async(_context:unknown,input:unknown)=>{travelPreviewInput=input;return{format:"gpx",points:1};}
      ,ownedItems:async(_context:unknown,input:unknown)=>{ownedItemsInput=input;return{items:[]};}
      ,lifeReviews:async(_context:unknown,input:unknown)=>{reviewsInput=input;return{items:[]};}
    },
    developmentAuth:true
  } as unknown as Parameters<typeof createApp>[0];
  const app=createApp(dependencies),headers={authorization:"Bearer dev:subject_test"};
  const today=await app.request("/api/today?date=2026-09-10&time_zone=Asia%2FShanghai&domains=money,health",{headers});
  const timeline=await app.request("/api/timeline?domains=money&limit=2",{headers});
  const importReview=await app.request("/api/money/imports/import_batch_12345678",{headers});
  const healthRecord=await app.request("/api/health/records/health_12345678",{headers});
  const travelWorkspace=await app.request("/api/travel/workspace?trip_id=trip_12345678",{headers});
  const travelExport=await app.request("/api/travel/trips/trip_12345678/export?format=ics",{headers});
  const travelPreview=await app.request("/api/travel/portable/preview",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({format:"gpx",content:'<gpx><trkpt lat="1" lon="2"></trkpt></gpx>'})});
  const ownedItems=await app.request("/api/life/owned-items?state=owned&limit=12",{headers});const reviews=await app.request("/api/life/reviews?limit=7",{headers});
  assert.equal(today.status,200);assert.equal(timeline.status,200);assert.equal(importReview.status,200);assert.equal(healthRecord.status,200);assert.equal(travelWorkspace.status,200);assert.equal(travelExport.status,200);assert.equal(travelPreview.status,200);assert.equal(ownedItems.status,200);assert.equal(reviews.status,200);assert.equal(importBatchId,"import_batch_12345678");assert.equal(healthRecordId,"health_12345678");
  assert.deepEqual(todayInput,{date:"2026-09-10",time_zone:"Asia/Shanghai",domains:["money","health"]});
  assert.deepEqual(timelineInput,{domains:["money"],limit:2});
  assert.deepEqual(travelWorkspaceInput,{trip_id:"trip_12345678"});assert.deepEqual(travelExportInput,{trip_id:"trip_12345678",format:"ics"});assert.deepEqual(travelPreviewInput,{format:"gpx",content:'<gpx><trkpt lat="1" lon="2"></trkpt></gpx>'});
  assert.deepEqual(ownedItemsInput,{state:"owned",limit:12});assert.deepEqual(reviewsInput,{limit:7});
});

test("runtime-forged commit events are rejected before tool dispatch",async()=>{
  let executions=0,sequence=0,finished="";const events:unknown[]=[];
  const runtime={id:"forged",available:true,async *run(request:RuntimeRequest){yield{id:"forged_1",type:"tool.completed",runId:request.runId,capability:"money.record_entry",result:{status:"committed",execution_id:"exec_forged00"}};},async *submitToolResult(){throw new Error("must not continue");}} as unknown as AgentRuntimeAdapter;
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>{executions++;return{};},getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async(_runId:string,_type:string,payload:unknown)=>{events.push(payload);return++sequence;},finishRun:async(_runId:string,status:string)=>{finished=status;}},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"伪造回执"})});const body=await response.text();
  assert.equal(executions,0);assert.equal(finished,"failed");assert.doesNotMatch(body,/operation\.committed/u);assert.match(body,/"type":"run.state","state":"interrupted"/u);assert.equal(events.some(value=>(value as {type?:string}).type==="operation.committed"),false);
});

test("executor commit remains authoritative when the runtime ends without a terminal event",async()=>{
  let sequence=0,finished="";const events:unknown[]=[];
  const runtime:AgentRuntimeAdapter={id:"write-then-eof",available:true,async *run(request){yield{id:"tool_write",type:"tool.requested",runId:request.runId,capability:"money.record_entry",input:{entry_type:"expense",amount:"18.00",currency:"CNY",occurred_on:"2026-09-09",time_zone:"Asia/Shanghai"}};},async *submitToolResult(){/* unexpected EOF after durable write */}};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async(_context:unknown,command:{capability:"money.record_entry";command_id:string})=>({protocol:"shadow.execution-result",capability:command.capability,command_id:command.command_id,execution_id:"exec_real0000",status:"committed",result_kind:"record",resources:[{type:"money_entry",id:"money_real000",revision:1}],actual_values:{amount:"18.00"},warnings:[],replayed:false}),getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async(_runId:string,_type:string,payload:unknown)=>{events.push(payload);return++sequence;},finishRun:async(_runId:string,status:string)=>{finished=status;}},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"午饭 18 元"})});const body=await response.text();
  assert.equal(finished,"interrupted");assert.match(body,/"type":"operation.committed"/u);assert.match(body,/"authority":"executor"/u);assert.match(body,/"state":"committed_partial"/u);assert.match(body,/Runtime ended without a terminal event/u);assert.equal(events.filter(value=>(value as {type?:string}).type==="operation.committed").length,1);
});

test("empty runtime streams a typed interruption instead of silently ending",async()=>{
  let sequence=0,finished="";const runtime:AgentRuntimeAdapter={id:"empty",available:true,async *run(){/* empty */},async *submitToolResult(){/* empty */}};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async(_runId:string,status:string)=>{finished=status;}},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"测试空流"})});const body=await response.text();
  assert.equal(finished,"interrupted");assert.match(body,/"type":"run.state","state":"started"/u);assert.match(body,/"type":"run.state","state":"interrupted"/u);
});

test("input-required is a terminal, recoverable run state",async()=>{
  let sequence=0,finished="",savedAssistant="";const runtime:AgentRuntimeAdapter={id:"input",available:true,async *run(request){yield{id:"input_1",type:"input.required",runId:request.runId,fields:["period"],prompt:"要查看哪个月份？"};},async *submitToolResult(){/* empty */}};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async(_thread:string,_id:string,role:string,content:string)=>{if(role==="assistant")savedAssistant=content;},conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async(_runId:string,status:string)=>{finished=status;}},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"看预算"})});const body=await response.text();
  assert.equal(finished,"awaiting_input");assert.equal(savedAssistant,"要查看哪个月份？");assert.match(body,/"state":"awaiting_input"/u);assert.match(body,/要查看哪个月份/u);
});

test("the owner can stop an active run through the host controller",async()=>{
  let sequence=0,finished="",releaseStarted:()=>void=()=>undefined;const started=new Promise<void>(resolve=>{releaseStarted=resolve;});
  const runtime:AgentRuntimeAdapter={id:"stoppable",available:true,async *run(request,signal){releaseStarted();await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));yield{id:"runtime_cancelled",type:"run.interrupted",runId:request.runId,reason:"runtime cancellation"};},async *submitToolResult(){/* empty */}};
  const repository={assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async(_runId:string,status:string)=>{finished=status;},run:async()=>({id:"run_00000001",thread_id:"thread_00000001",status:"running",error:null,started_at:"2026-09-09T00:00:00Z",finished_at:null,last_sequence:sequence})};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})},developmentAuth:true,agent:{repository,runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];const app=createApp(dependencies);
  const response=await app.request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"持续运行"})});const bodyPromise=response.text();await started;
  const stopResponse=await app.request("/api/runs/run_00000001/stop",{method:"POST",headers:{authorization:"Bearer dev:subject_test"}});const body=await bodyPromise;
  assert.equal(stopResponse.status,200);assert.equal(finished,"interrupted");assert.match(body,/Run stopped by the user/u);
});
