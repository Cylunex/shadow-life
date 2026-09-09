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
    queries:{listMeals:async()=>[],summarizeMoney:async()=>({currency:"CNY",expense_total:"100.00",entries:3,as_of:"2026-09-08T00:00:00.000Z",totals:[{currency:"CNY",gross_expense:"100",refund:"20",net_spending:"80",income:"0",net_cashflow:"-80",entries:3}]})},
    developmentAuth:true,
    agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[{id:"message_old",role:"user",content:"午饭 18 元",createdAt:"2026-09-08T00:00:00Z"}],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async()=>undefined},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}
  } as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"最近花了多少？"})});
  const body=await response.text();
  assert.equal(response.status,200);assert.equal(started?.history?.[0]?.content,"午饭 18 元");assert.deepEqual(started?.personalContext,{aliases:[],mealTemplates:[]});assert.equal(submitted?.capability,"money.summarize");assert.deepEqual((submitted?.result as {totals:unknown[]}).totals[0],{currency:"CNY",gross_expense:"100",refund:"20",net_spending:"80",income:"0",net_cashflow:"-80",entries:3});assert.match(body,/净支出为 80 元/u);
});

test("missing tool facts return to the runtime so it can ask one follow-up",async()=>{
  let submitted:RuntimeToolResult|undefined,sequence=0;
  const runtime:AgentRuntimeAdapter={id:"test",available:true,async *run(request){yield{id:"tool_missing",type:"tool.requested",runId:request.runId,capability:"money.planning",input:{}};},async *submitToolResult(request){submitted=request;yield{id:"ask_1",type:"message.delta",runId:request.runId,text:"要查看哪个月份？"};yield{id:"done_1",type:"run.completed",runId:request.runId};}};
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{},developmentAuth:true,agent:{repository:{assertThread:async()=>undefined,addMessage:async()=>undefined,conversation:async()=>[],createRun:async()=>undefined,appendEvent:async()=>++sequence,finishRun:async()=>undefined},runtime,nextId:(type:"thread"|"message"|"run")=>`${type}_00000001`}} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/threads/thread_00000001/runs",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({text:"看下预算"})});const body=await response.text();
  assert.equal(response.status,200);assert.equal((submitted?.result as {code:string}).code,"missing_fact");assert.deepEqual((submitted?.result as {fields:string[]}).fields,["period"]);assert.match(body,/要查看哪个月份/u);
});

test("missing resources are returned as 404 errors",async()=>{
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{lifeRecord:async()=>{throw notFound("life record");}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/life/records/missing_record",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,404);assert.equal((await response.json() as {code:string}).code,"not_found");
});
