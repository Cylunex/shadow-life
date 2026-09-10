import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test,{type TestContext} from "node:test";
import { AgentRepository,PostgresUnitOfWork,migrate } from "@shadow/database";
import { CommandExecutor,QueryService,sha256Fingerprinter,systemClock,uuidIds } from "@shadow/kernel";
import { capabilityRegistry } from "@shadow/contracts";
import type { AgentRuntimeAdapter,RuntimeRequest,RuntimeToolResult } from "@shadow/agent-adapter";
import { createApp } from "../src/app.js";
const pgOnly={skip:!process.env.TEST_DATABASE_URL};
async function fixture(t:TestContext){
  const admin=new PostgresUnitOfWork({connectionString:process.env.TEST_DATABASE_URL}),name=`api_review_${randomUUID().replaceAll("-","")}`;
  await admin.pool.query(`create database "${name}"`);const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname=`/${name}`;
  const unitOfWork=new PostgresUnitOfWork({connectionString:url.toString()});
  t.after(async()=>{await unitOfWork.close();await admin.pool.query(`drop database "${name}" with (force)`);await admin.close();});
  const pool=unitOfWork.pool;await migrate(pool);await pool.query("update write_epochs set stage='life',epoch=epoch+1");
  const subjectId="subject_api_review",context={actorId:subjectId,subjectId,clientId:"client_review",traceId:"trace_review",effects:new Set(Object.values(capabilityRegistry).flatMap(c=>c.possibleEffects))};await unitOfWork.ensurePrincipal(subjectId);
  const executor=new CommandExecutor({unitOfWork,ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter}),queries=new QueryService(unitOfWork);
  const run=(capability:string,input:unknown)=>executor.execute(context,{protocol:"shadow.command",capability,command_id:`cmd_${randomUUID()}`,input});
  const headers={authorization:`Bearer dev:${subjectId}`,"content-type":"application/json"};
  const app=(runtime:AgentRuntimeAdapter,repository=new AgentRepository(pool))=>createApp({unitOfWork,executor,queries,developmentAuth:true,agent:{repository,runtime,nextId:type=>uuidIds.next(type)}});
  return{pool,context,run,headers,app,queries};
}
const completed:AgentRuntimeAdapter={id:"local-stub",available:true,async *run(request){yield{id:"done",type:"run.completed",runId:request.runId};},async *submitToolResult(){throw Error("unexpected continuation");}};

test("F09 API: restart, orphan stop and rejected concurrent runs do not strand or duplicate messages",pgOnly,async t=>{
  const {pool,context,headers,app}=await fixture(t),repository=new AgentRepository(pool);
  await repository.createThread(context.subjectId,"thread_api_restart","重启测试");
  await repository.createRun("thread_api_restart","run_api_orphan",{id:"message_api_initial",content:"原消息"});
  const restarted=app(completed);
  const rejected=await restarted.request("/api/threads/thread_api_restart/runs",{method:"POST",headers,body:JSON.stringify({text:"还在执行"})});assert.equal(rejected.status,409);
  assert.equal((await repository.conversation(context.subjectId,"thread_api_restart")).length,1);
  await pool.query("update runs set lease_expires_at=clock_timestamp()-interval '1 second' where id='run_api_orphan'");
  const stopped=await restarted.request("/api/runs/run_api_orphan/stop",{method:"POST",headers});assert.equal(stopped.status,200);assert.equal((await stopped.json() as {status:string}).status,"interrupted");
  const started=await restarted.request("/api/threads/thread_api_restart/runs",{method:"POST",headers,body:JSON.stringify({text:"继续执行"})});assert.equal(started.status,200);assert.match(await started.text(),/"state":"completed"/);
  assert.equal((await repository.conversation(context.subjectId,"thread_api_restart")).length,2);
});

test("F01/F02 API: stale evidence never enters Runtime and public/Agent aggregate writes cannot forge facts",pgOnly,async t=>{
  const {pool,context,headers,app,run}=await fixture(t),repository=new AgentRepository(pool);await repository.createThread(context.subjectId,"thread_api_context","上下文测试");
  const meal=await run("life.record_meal",{occurred_on:"2026-09-10",time_zone:"UTC",meal_type:"lunch",items:[{name:"米饭",estimate:false}]}),refs=[{kind:"meal",id:meal.actual_values.meal_id,revision:1}];
  const pack=await run("agent.create_context_pack",{thread_id:"thread_api_context",object_refs:refs});
  await run("agent.set_memory",{category:"deterministic_aggregate",memory_key:"count",algorithm_version:"meal-count-v1",evidence_refs:refs});
  await run("life.correct_meal",{meal_id:meal.actual_values.meal_id,expected_revision:1,occurred_on:"2026-09-10",time_zone:"UTC",meal_type:"dinner",reason:"修正事实"});
  let started:RuntimeRequest|undefined,toolResult:RuntimeToolResult|undefined;
  const malicious:AgentRuntimeAdapter={...completed,async *run(request){started=request;yield{id:"forge_aggregate",type:"tool.requested",runId:request.runId,capability:"agent.set_memory",input:{category:"deterministic_aggregate",memory_key:"forged",algorithm_version:"meal-count-v1",value:{count:999999},evidence_refs:[{...refs[0],revision:2}]}};},async *submitToolResult(request){toolResult=request;yield{id:"done",type:"run.completed",runId:request.runId};}};
  const api=app(malicious,repository);
  const stale=await api.request("/api/threads/thread_api_context/runs",{method:"POST",headers,body:JSON.stringify({text:"解释",context_pack_id:pack.actual_values.context_pack_id})});assert.equal(stale.status,404);assert.equal(started,undefined);assert.equal((await repository.conversation(context.subjectId,"thread_api_context")).length,0);
  const response=await api.request("/api/threads/thread_api_context/runs",{method:"POST",headers,body:JSON.stringify({text:"查询记忆"})});await response.text();assert.equal(response.status,200);assert.deepEqual((started as RuntimeRequest|undefined)?.personalContext?.memories,[]);assert.equal((toolResult?.result as {protocol:string}).protocol,"shadow.runtime-tool-error");
  const forged=await api.request("/api/commands/agent.set_memory",{method:"POST",headers,body:JSON.stringify({protocol:"shadow.command",capability:"agent.set_memory",command_id:"cmd_api_fake_memory",input:{category:"deterministic_aggregate",memory_key:"fake_http",algorithm_version:"not-implemented",evidence_refs:[{...refs[0],revision:2}],value:{count:1}}})});assert.equal(forged.status,422);assert.match((await forged.json() as {message:string}).message,/not registered/);
  assert.equal((await pool.query("select count(*)::int n from user_memories")).rows[0].n,1);
});
