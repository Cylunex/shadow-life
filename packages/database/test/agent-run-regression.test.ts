import assert from "node:assert/strict";
import test from "node:test";
import { AgentRepository } from "../src/index.js";
import { reviewFixture,pgOnly,mealInput } from "./review-fixture.js";

test("F09: expired owners recover receipts and fence late events, writes and assistant messages",pgOnly,async t=>{
  const {pool,context,executor,command}=await reviewFixture(t),old=new AgentRepository(pool),current=new AgentRepository(pool),thread="thread_run_recovery",run="run_old_recovery";
  await old.createThread(context.subjectId,thread,"租约测试");await old.createRun(thread,run,{id:"message_original",content:"写入后崩溃"});
  const write=command("life.record_meal",mealInput),leaseContext={...context,agentRun:{runId:run,ownerId:old.ownerId,toolCallId:"tool_original"}};
  const receipt=await executor.execute(leaseContext,write);
  assert.equal((await old.events(context.subjectId,run)).length,0); // crash between commit and event append
  await assert.rejects(()=>current.createRun(thread,"run_conflicting",{id:"message_rejected",content:"不得遗留消息"}),/thread_has_active_run/);
  assert.equal((await old.conversation(context.subjectId,thread)).length,1);
  assert.equal(await current.heartbeat(run),false); // absence of a local controller cannot steal another live instance
  await pool.query("update runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[run]);
  assert.equal((await current.run(context.subjectId,run))?.status,"interrupted");
  const events=await current.events(context.subjectId,run);assert.equal(events.length,2);assert.equal(events[0]!.event_type,"operation.committed");assert.equal((events[0]!.payload as {execution_id:string}).execution_id,receipt.execution_id);
  assert.equal(await old.heartbeat(run),false);
  await assert.rejects(()=>old.appendEvent(run,"message.delta",{text:"late"}),/lease/);
  await assert.rejects(()=>old.finishRun(run,"completed",undefined,{id:"message_late",content:"不得插入"}),/lease/);
  await assert.rejects(()=>executor.execute(leaseContext,command("life.record_meal",mealInput)),/lease/);
  assert.equal((await executor.execute(leaseContext,write)).replayed,true); // already committed operation is retrievable, never re-executed
  await current.createRun(thread,"run_after_recovery",{id:"message_after",content:"继续"});
  assert.equal((await pool.query("select count(*)::int n from meals")).rows[0].n,1);
  assert.equal((await old.conversation(context.subjectId,thread)).length,2);
  assert.equal((await current.events(context.subjectId,run)).length,2);
  await current.finishRun("run_after_recovery","completed");
});

test("F09: cross-instance stop is persistent and pre-lease legacy runs end deterministically",pgOnly,async t=>{
  const {pool,context,executor,command}=await reviewFixture(t),owner=new AgentRepository(pool),other=new AgentRepository(pool);
  await owner.createThread(context.subjectId,"thread_stop_recovery","停止测试");await owner.createRun("thread_stop_recovery","run_stop_recovery");
  assert.equal(await other.requestStop("subject_unauthorized","run_stop_recovery"),undefined);
  assert.equal(await other.requestStop(context.subjectId,"run_stop_recovery"),"stopping");
  assert.equal((await other.run(context.subjectId,"run_stop_recovery"))?.status,"running");
  assert.equal(await owner.heartbeat("run_stop_recovery"),false);
  await assert.rejects(()=>executor.execute({...context,agentRun:{runId:"run_stop_recovery",ownerId:owner.ownerId,toolCallId:"tool_after_stop"}},command("money.record_entry",{entry_type:"expense",amount:"1.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"UTC"})),/lease/);
  await owner.finishRun("run_stop_recovery","completed");assert.equal((await other.run(context.subjectId,"run_stop_recovery"))?.status,"interrupted");
  await pool.query("insert into runs(id,thread_id,status) values('run_before_leases','thread_stop_recovery','running')");
  assert.equal(await other.requestStop(context.subjectId,"run_before_leases"),"interrupted");
  await other.createRun("thread_stop_recovery","run_after_legacy");await other.finishRun("run_after_legacy","completed");
});
