import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { capabilityRegistry } from "@shadow/contracts";
import { AssetService, processPendingLibrary } from "../src/index.js";
import { pgOnly, reviewFixture } from "./review-fixture.js";

async function queue(f:Awaited<ReturnType<typeof reviewFixture>>,processor="external-text-v1"){
  const asset=await new AssetService(f.pool).store(f.context.subjectId,"text/markdown",Buffer.from("固定原件和可检索内容"));
  const capture=await f.run("library.capture",{title:"恢复测试",item_type:"document",tags:[],source:{kind:"import",captured_on:"2026-09-11",asset_version_id:asset.asset_version_id}});
  const itemId=String(capture.actual_values.library_item_id);
  const queued=await f.run("library.queue_processing",{item_id:itemId,source_asset_version_id:asset.asset_version_id,kind:"text_extract",requested_processor:processor});
  const jobId=String(queued.actual_values.library_processing_job_id);
  const derived=await new AssetService(f.pool).store(f.context.subjectId,"text/plain",Buffer.from("检索内容"));
  const complete=(attempt:number)=>({job_id:jobId,attempt,derived_asset_version_id:derived.asset_version_id,processor_version:processor,snippets:[{text:"检索内容",locator:{offset:0}}]});
  return{jobId,itemId,asset,complete};
}

test("library leases recover after expiry and fence stale results, failures and renewals",pgOnly,async t=>{
  const f=await reviewFixture(t),job=await queue(f);
  const claim=f.command("library.claim_processing",{job_id:job.jobId,expected_attempt:0});
  const first=await f.executor.execute(f.context,claim);
  assert.equal(first.actual_values.attempt,1);
  assert.equal((await f.executor.execute(f.context,claim)).replayed,true);
  assert.ok(Date.parse(String(first.actual_values.lease_expires_at))>Date.now());
  await assert.rejects(()=>f.run("library.claim_processing",{job_id:job.jobId,expected_attempt:1}),/unavailable/u);
  await f.pool.query("update library_processing_jobs set lease_expires_at=clock_timestamp()+interval '30 seconds' where id=$1",[job.jobId]);
  const renew=f.command("library.renew_processing",{job_id:job.jobId,attempt:1});
  const renewed=await f.executor.execute(f.context,renew);
  assert.ok(Date.parse(String(renewed.actual_values.lease_expires_at))>Date.now()+240_000);
  const replay=await f.executor.execute(f.context,renew);
  assert.equal(replay.replayed,true);
  assert.equal(replay.actual_values.lease_expires_at,renewed.actual_values.lease_expires_at);
  assert.equal((await f.queries.libraryProcessingQueue(f.context,{}) as {items:unknown[]}).items.length,0);
  await f.pool.query("update library_processing_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[job.jobId]);
  await assert.rejects(()=>f.run("library.renew_processing",{job_id:job.jobId,attempt:1}),/lease expired/u);
  await assert.rejects(()=>f.run("library.complete_processing",job.complete(1)),/lease expired/u);
  const ready=await f.queries.libraryProcessingQueue(f.context,{}) as {items:Array<{id:string;attempts:number}>};
  assert.equal(ready.items[0]?.id,job.jobId);assert.equal(ready.items[0]?.attempts,1);
  // A different Executor instance simulates the new process; no in-memory owner is shared.
  const {CommandExecutor,sha256Fingerprinter,systemClock,uuidIds}=await import("@shadow/kernel");
  const {PostgresUnitOfWork}=await import("../src/index.js");
  const restarted=new CommandExecutor({unitOfWork:new PostgresUnitOfWork(f.pool),ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter});
  const second=await restarted.execute(f.context,f.command("library.claim_processing",{job_id:job.jobId,expected_attempt:1}));
  assert.equal(second.actual_values.attempt,2);
  for(const [capability,input] of [
    ["library.fail_processing",{job_id:job.jobId,attempt:1,error:"late failure"}],
    ["library.complete_processing",job.complete(1)],
    ["library.renew_processing",{job_id:job.jobId,attempt:1}]
  ] as const)await assert.rejects(()=>f.run(capability,input),/stale/u);
  const complete=f.command("library.complete_processing",job.complete(2));
  await restarted.execute(f.context,complete);
  assert.equal((await restarted.execute(f.context,complete)).replayed,true);
  await assert.rejects(()=>f.run("library.fail_processing",{job_id:job.jobId,attempt:2,error:"lost success reply"}),/stale/u);
  await assert.rejects(()=>f.run("library.retry_processing",{job_id:job.jobId}),/not failed/u);
  const saved=(await f.pool.query("select state,attempts,lease_expires_at,last_error from library_processing_jobs where id=$1",[job.jobId])).rows[0];
  assert.deepEqual(saved,{state:"completed",attempts:2,lease_expires_at:null,last_error:null});
  assert.equal((await f.pool.query("select count(*)::int count from library_snippets where job_id=$1",[job.jobId])).rows[0].count,1);
});

test("library claims race atomically, authorize ownership and roll back partial completion",pgOnly,async t=>{
  const f=await reviewFixture(t),job=await queue(f);
  const commands=[f.command("library.claim_processing",{job_id:job.jobId,expected_attempt:0}),f.command("library.claim_processing",{job_id:job.jobId,expected_attempt:0})];
  const claims=await Promise.allSettled(commands.map(command=>f.executor.execute(f.context,command)));
  assert.equal(claims.filter(result=>result.status==="fulfilled").length,1);
  assert.equal((await f.pool.query("select attempts from library_processing_jobs where id=$1",[job.jobId])).rows[0].attempts,1);
  await f.unitOfWork.ensurePrincipal("subject_other_processor");
  await assert.rejects(()=>f.run("library.complete_processing",job.complete(1),{...f.context,subjectId:"subject_other_processor"}),/stale/u);
  await assert.rejects(()=>f.run("library.fail_processing",{job_id:job.jobId,attempt:1,error:"denied"},{...f.context,effects:new Set()}),/Missing permission/u);
  // Inject an actual SQL failure after derivation insertion to check Executor atomicity.
  await f.pool.query("create function reject_library_snippet() returns trigger language plpgsql as $$ begin raise exception 'fixture snippet failure'; end $$");
  await f.pool.query("create trigger reject_library_snippet before insert on library_snippets for each row execute function reject_library_snippet()");
  const command=f.command("library.complete_processing",job.complete(1));
  await assert.rejects(()=>f.executor.execute(f.context,command),(error:unknown)=>error instanceof Error && String(error.cause).includes("fixture snippet failure"));
  assert.equal((await f.pool.query("select count(*)::int count from library_derivations where item_id=$1",[job.itemId])).rows[0].count,0);
  assert.equal((await f.pool.query("select count(*)::int count from operations where command_id=$1",[command.command_id])).rows[0].count,0);
  assert.equal((await f.pool.query("select state from library_processing_jobs where id=$1",[job.jobId])).rows[0].state,"running");
  await f.pool.query("drop trigger reject_library_snippet on library_snippets");
  await f.executor.execute(f.context,command);
  assert.equal((await f.pool.query("select count(*)::int count from outbox where event_type='library.complete_processing.committed' and aggregate_id=$1",[job.jobId])).rows[0].count,1);
});

test("builtin processing uses public receipts and concurrent dispatch preserves original bytes",pgOnly,async t=>{
  const f=await reviewFixture(t),job=await queue(f,"builtin-text-v1");
  const results=(await Promise.all([processPendingLibrary(f.pool),processPendingLibrary(f.pool)])).flat();
  assert.deepEqual(results,[{job_id:job.jobId,state:"completed"}]);
  const receipts=await f.pool.query("select capability from operations where result->'actual_values'->>'library_processing_job_id'=$1 order by capability",[job.jobId]);
  assert.deepEqual(receipts.rows.map(row=>row.capability),["library.claim_processing","library.complete_processing","library.queue_processing"]);
  assert.equal((await f.pool.query("select bytes from asset_blobs where asset_version_id=$1",[job.asset.asset_version_id])).rows[0].bytes.toString(),"固定原件和可检索内容");
  assert.deepEqual(await processPendingLibrary(f.pool),[]);
  await assert.rejects(()=>processPendingLibrary(f.pool,0),RangeError);
});

test("library upgrade makes legacy running jobs reclaimable without changing terminal results",pgOnly,async t=>{
  const f=await reviewFixture(t),running=await queue(f),completed=await queue(f);
  await f.run("library.claim_processing",{job_id:completed.jobId,expected_attempt:0});
  await f.run("library.complete_processing",completed.complete(1));
  // Reconstruct the precise old table shape with populated data, then apply production SQL.
  await f.pool.query("alter table library_processing_jobs drop column lease_expires_at cascade");
  await f.pool.query("update library_processing_jobs set state='running',attempts=4 where id=$1",[running.jobId]);
  const sql=await readFile(new URL("../migrations/0032_library_processing_leases.sql",import.meta.url),"utf8");
  await f.pool.query(sql);
  const next=await f.run("library.claim_processing",{job_id:running.jobId,expected_attempt:4});
  assert.equal(next.actual_values.attempt,5);
  assert.equal((await f.pool.query("select state,attempts,lease_expires_at from library_processing_jobs where id=$1",[completed.jobId])).rows[0].state,"completed");
  assert.equal((await f.pool.query("select count(*)::int count from library_snippets where job_id=$1",[completed.jobId])).rows[0].count,1);
});

test("library processor contracts require explicit generations",()=>{
  assert.equal(capabilityRegistry["library.claim_processing"].inputSchema.safeParse({job_id:"library_job_12345678"}).success,false);
  assert.equal(capabilityRegistry["library.fail_processing"].inputSchema.safeParse({job_id:"library_job_12345678",error:"late"}).success,false);
  assert.equal(capabilityRegistry["library.renew_processing"].inputSchema.safeParse({job_id:"library_job_12345678",attempt:0}).success,false);
});

test("library renewal checks expiry after waiting for a database lock",pgOnly,async t=>{
  const f=await reviewFixture(t),job=await queue(f);
  await f.run("library.claim_processing",{job_id:job.jobId,expected_attempt:0});
  await f.pool.query("update library_processing_jobs set lease_expires_at=clock_timestamp()+interval '150 milliseconds' where id=$1",[job.jobId]);
  const blocker=await f.pool.connect();
  await blocker.query("begin");
  await blocker.query("select id from library_processing_jobs where id=$1 for update",[job.jobId]);
  const result=f.run("library.renew_processing",{job_id:job.jobId,attempt:1}).then(()=>"unexpected success",error=>String(error));
  try{await new Promise(resolve=>setTimeout(resolve,250));}
  finally{await blocker.query("rollback");blocker.release();}
  assert.match(await result,/lease expired/u);
});

test("builtin batch leaves later files unclaimed while its first file is processing",pgOnly,async t=>{
  const f=await reviewFixture(t),first=await queue(f,"builtin-text-v1"),second=await queue(f,"builtin-text-v1");
  await f.pool.query("create function block_library_snippet() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(981137); return new; end $$");
  await f.pool.query("create trigger block_library_snippet before insert on library_snippets for each row execute function block_library_snippet()");
  const blocker=await f.pool.connect();
  await blocker.query("begin");await blocker.query("select pg_advisory_xact_lock(981137)");
  const processing=processPendingLibrary(f.pool);
  try{
    const deadline=Date.now()+3_000;
    let waiting=false;
    while(Date.now()<deadline){
      waiting=(await f.pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory') waiting")).rows[0].waiting;
      if(waiting)break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(waiting,true,"worker reached first snippet transaction");
    assert.deepEqual((await f.pool.query("select state,attempts from library_processing_jobs where id=$1",[first.jobId])).rows[0],{state:"running",attempts:1});
    assert.deepEqual((await f.pool.query("select state,attempts from library_processing_jobs where id=$1",[second.jobId])).rows[0],{state:"queued",attempts:0});
  }finally{await blocker.query("rollback");blocker.release();await processing;}
  assert.equal((await f.pool.query("select count(*)::int count from library_processing_jobs where state='completed'")).rows[0].count,2);
});
