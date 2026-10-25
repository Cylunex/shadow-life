import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test,{type TestContext} from "node:test";
import { AgentRepository,AssetService,PostgresUnitOfWork,migrate } from "@shadow/database";
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

test("run discovery and bounded pages drain a long terminal log without duplicating messages or writes",pgOnly,async t=>{
  const {pool,context,headers,app}=await fixture(t),repository=new AgentRepository(pool);
  await repository.createThread(context.subjectId,"thread_long_log","长事件日志");await repository.createRun("thread_long_log","run_long_log",{id:"message_long_log",content:"唯一用户消息"});
  await pool.query("insert into run_events(run_id,sequence,event_type,payload) select 'run_long_log',n,'message.delta',jsonb_build_object('id','delta_'||n,'run_id','run_long_log','type','message.delta','runtime_event_id','runtime_'||n,'text',n::text||',') from generate_series(1,450) n");
  await repository.appendEvent("run_long_log","run.state",{id:"done",run_id:"run_long_log",type:"run.state",state:"completed"});await repository.finishRun("run_long_log","completed");
  const api=app(completed,repository),discovery=await api.request("/api/threads/thread_long_log/runs",{headers});assert.equal(discovery.status,200);assert.equal((await discovery.json() as {items:Array<{id:string}>}).items[0]?.id,"run_long_log");
  let after=0,count=0,pages=0;
  while(true){const response=await api.request(`/api/runs/run_long_log?after=${after}&limit=73`,{headers}),page=await response.json() as {run:{last_sequence:number;status:string};events:Array<{sequence:number}>;next_after:number;has_more:boolean};assert.equal(response.status,200);assert.ok(page.events.length<=73);assert.equal(page.run.status,"completed");for(const event of page.events)assert.equal(event.sequence,++count);after=page.next_after;pages++;if(!page.has_more){assert.equal(after,page.run.last_sequence);break;}}
  assert.equal(count,451);assert.equal(pages,7);
  // Existing native clients omit limit and expect a complete normal Host run.
  const legacy=await api.request("/api/runs/run_long_log?after=0",{headers});assert.equal((await legacy.json() as {events:unknown[]}).events.length,451);
  const other={authorization:"Bearer dev:subject_other"};assert.equal((await api.request("/api/runs/run_long_log",{headers:other})).status,404);assert.deepEqual(await (await api.request("/api/threads/thread_long_log/runs",{headers:other})).json(),{items:[]});
  assert.equal((await api.request("/api/runs/run_long_log?limit=1001",{headers})).status,422);
  assert.equal((await pool.query("select count(*)::int n from messages")).rows[0].n,1);assert.equal((await pool.query("select count(*)::int n from operations")).rows[0].n,0);
});

test("stopping after a real commit preserves its receipt and never claims transaction rollback",pgOnly,async t=>{
  const {pool,context,headers,app}=await fixture(t),repository=new AgentRepository(pool);await repository.createThread(context.subjectId,"thread_commit_stop","停止竞争");
  let notify!:()=>void;const committed=new Promise<void>(resolve=>{notify=resolve;});
  const runtime:AgentRuntimeAdapter={...completed,async *run(request){yield{id:"meal_once",type:"tool.requested",runId:request.runId,capability:"life.record_meal",input:{occurred_on:"2026-10-15",time_zone:"UTC",meal_type:"lunch",items:[{name:"合成午饭",estimate:false}]}};},async *submitToolResult(request,signal){notify();await new Promise<void>(resolve=>{if(signal?.aborted)resolve();else signal?.addEventListener("abort",()=>resolve(),{once:true});});yield{id:"stop",runId:request.runId,type:"run.interrupted",reason:"stopped"};}};
  const api=app(runtime,repository),response=await api.request("/api/threads/thread_commit_stop/runs",{method:"POST",headers,body:JSON.stringify({text:"保存一项后停止"})}),stream=response.text();await committed;
  const runId=response.headers.get("X-Shadow-Run-Id");assert.ok(runId);
  const stop=await api.request(`/api/runs/${runId}/stop`,{method:"POST",headers});assert.equal((await stop.json() as {status:string}).status,"stopping");
  assert.match(await stream,/operation.committed/);
  const page=await (await api.request(`/api/runs/${runId}`,{headers})).json() as {run:{status:string};events:Array<{event_type:string}>};
  assert.equal(page.run.status,"interrupted");assert.equal(page.events.filter(event=>event.event_type==="operation.committed").length,1);
  assert.equal((await pool.query("select count(*)::int n from meals")).rows[0].n,1);assert.equal((await pool.query("select count(*)::int n from operations where capability='life.record_meal'")).rows[0].n,1);
});

test("HTML is available only as an authenticated isolated attachment",pgOnly,async t=>{
  const {pool,context,headers,app}=await fixture(t),bytes=Buffer.from('<script>document.cookie</script><article>合成网页正文</article>'),asset=await new AssetService(pool).store(context.subjectId,"text/html",bytes),api=app(completed);
  const download=await api.request(`/api/assets/${asset.asset_version_id}`,{headers});assert.equal(download.status,200);assert.equal(download.headers.get("content-type"),"application/octet-stream");assert.match(download.headers.get("content-disposition")??"",/^attachment/u);assert.equal(download.headers.get("x-content-type-options"),"nosniff");assert.equal(await download.text(),bytes.toString());
  assert.equal((await api.request(`/api/assets/${asset.asset_version_id}/preview`,{headers})).status,415);
  assert.equal((await api.request(`/api/assets/${asset.asset_version_id}`)).status,401);
  assert.equal((await api.request(`/api/assets/${asset.asset_version_id}`,{headers:{authorization:"Bearer dev:subject_other"}})).status,404);
});

test("stop between commit and Host publication recovers exactly one real receipt",pgOnly,async t=>{
  const {pool,context,headers,app}=await fixture(t),repository=new AgentRepository(pool);await repository.createThread(context.subjectId,"thread_commit_gap","提交与发布竞争");
  const append=repository.appendEvent.bind(repository);let raced=false;
  repository.appendEvent=async(runId,type,payload)=>{if(type==="operation.committed"&&!raced){raced=true;await repository.requestStop(context.subjectId,runId);}return append(runId,type,payload);};
  const runtime:AgentRuntimeAdapter={...completed,async *run(request){yield{id:"write_once",type:"tool.requested",runId:request.runId,capability:"library.capture",input:{title:"竞争回执",item_type:"note",text:"已提交内容",tags:[]}};}};
  const api=app(runtime,repository),response=await api.request("/api/threads/thread_commit_gap/runs",{method:"POST",headers,body:JSON.stringify({text:"合成竞争"})});await response.text();assert.ok(raced);
  const runId=response.headers.get("X-Shadow-Run-Id"),page=await (await api.request(`/api/runs/${runId}?limit=2`,{headers})).json() as {run:{status:string};has_more:boolean};assert.equal(page.run.status,"interrupted");assert.ok(page.has_more);
  const events=await repository.events(context.subjectId,runId!);assert.equal(events.filter(event=>event.event_type==="operation.committed").length,1);
  assert.equal((await pool.query("select count(*)::int n from operations where capability='library.capture'")).rows[0].n,1);
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

test("F09 API: a different instance requests stop and the live owner's heartbeat terminates the stream",{...pgOnly,timeout:15_000},async t=>{
  const {pool,context,headers,app}=await fixture(t),owner=new AgentRepository(pool);await owner.createThread(context.subjectId,"thread_two_instances","多实例停止");
  let notifyStarted!:()=>void;const began=new Promise<void>(resolve=>{notifyStarted=resolve;});
  const waiting:AgentRuntimeAdapter={...completed,async *run(request,signal){notifyStarted();await new Promise<void>(resolve=>{if(signal?.aborted)resolve();else signal?.addEventListener("abort",()=>resolve(),{once:true});});yield{id:"stopped",type:"run.interrupted",runId:request.runId,reason:"signal stopped"};}};
  const response=await app(waiting,owner).request("/api/threads/thread_two_instances/runs",{method:"POST",headers,body:JSON.stringify({text:"等待停止"})}),body=response.text();await began;
  const id=String((await pool.query("select id from runs where thread_id='thread_two_instances'")).rows[0].id);
  const observer=app(completed),stop=await observer.request(`/api/runs/${id}/stop`,{method:"POST",headers});assert.equal((await stop.json() as {status:string}).status,"stopping");
  assert.match(await body,/"state":"interrupted"/);
  assert.equal((await owner.run(context.subjectId,id))?.status,"interrupted");
});
