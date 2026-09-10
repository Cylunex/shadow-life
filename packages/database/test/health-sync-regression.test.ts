import assert from "node:assert/strict";
import test from "node:test";
import { processPendingHealth } from "../src/index.js";
import { reviewFixture,pgOnly } from "./review-fixture.js";

const base={source_type:"health_connect",source_instance_key:"review-health-device",source_fingerprint:"permission-review",device_id:"review-health-device",record_type:"steps_interval",permission_fingerprint:"permission-review",sync_epoch:1,previous_cursor:null,next_cursor:"cursor-1",parse_version:"health-connect-2"};
function steps(id:string,start:string,end:string,count:number,origin="example.provider",version=1){return{client_record_id:id,provider_record_id:id,record_version:version,change_kind:"upsert",payload:{occurred_on:start.slice(0,10),time_zone:"UTC",steps:count,step_interval:{started_at:start,ended_at:end,data_origin:origin},field_sources:{steps:`health_connect:${origin}`}}};}
const window={generation:"hcscan_regression_0001",window_start:"2026-09-01T00:00:00Z",window_end:"2026-09-11T00:00:00Z",complete:true};

test("F07: interval steps sum without source duplication and rebuild on update/delete",pgOnly,async t=>{
  const {pool,run,queries,context,executor,command}=await reviewFixture(t);
  const a=steps("steps_a","2026-09-10T01:00:00Z","2026-09-10T02:00:00Z",100),b=steps("steps_b","2026-09-10T02:00:00Z","2026-09-10T03:00:00Z",200);
  const cmd=command("health.ingest_batch",{...base,records:[a,b]});await executor.execute(context,cmd);assert.equal((await executor.execute(context,cmd)).replayed,true);await processPendingHealth(pool);
  const daily=async(date="2026-09-10")=>(await queries.healthDaily(context,date) as {result:{activity:{steps:number}}}).result.activity.steps;
  assert.equal(await daily(),300);
  await run("health.ingest_batch",{...base,previous_cursor:"cursor-1",next_cursor:"cursor-2",records:[{...a,client_record_id:"steps_duplicate",provider_record_id:"steps_duplicate"},steps("other_source","2026-09-10T01:00:00Z","2026-09-10T03:00:00Z",280,"another.provider")]});await processPendingHealth(pool);assert.equal(await daily(),300);
  await run("health.ingest_batch",{...base,previous_cursor:"cursor-2",next_cursor:"cursor-3",records:[{...b,record_version:2,payload:{...b.payload,steps:250}},steps("midnight","2026-09-10T23:50:00Z","2026-09-11T00:10:00Z",40)]});await processPendingHealth(pool);assert.equal(await daily(),390);
  const stored=(await pool.query("select steps_started_at::text,steps_ended_at::text,steps_origin from health_daily_activity where steps=40")).rows[0];assert.equal(new Date(stored.steps_started_at).toISOString(),"2026-09-10T23:50:00.000Z");assert.equal(new Date(stored.steps_ended_at).toISOString(),"2026-09-11T00:10:00.000Z");
  await run("health.ingest_batch",{...base,previous_cursor:"cursor-3",next_cursor:"cursor-4",records:[{client_record_id:"steps_b",record_version:3,change_kind:"delete"}]});await processPendingHealth(pool);assert.equal(await daily(),280);
  await run("health.ingest_batch",{...base,source_type:"samsung",source_instance_key:"legacy-device",device_id:"legacy-device",record_type:"daily_activity",records:[{client_record_id:"daily_total",record_version:1,change_kind:"upsert",payload:{occurred_on:"2026-09-10",time_zone:"UTC",steps:500}},{client_record_id:"daily_total_copy",record_version:1,change_kind:"upsert",payload:{occurred_on:"2026-09-10",time_zone:"UTC",steps:450}}]});await processPendingHealth(pool);assert.equal(await daily(),500);
});

test("F08: only a complete, bounded generation reconciles absence and replays atomically",pgOnly,async t=>{
  const {pool,run,context,executor,command}=await reviewFixture(t);
  const a=steps("scan_a","2026-09-10T01:00:00Z","2026-09-10T02:00:00Z",100),b=steps("scan_b","2026-09-10T02:00:00Z","2026-09-10T03:00:00Z",200),old=steps("scan_old","2026-08-01T01:00:00Z","2026-08-01T02:00:00Z",300);
  await run("health.ingest_batch",{...base,records:[a,b,old]});await processPendingHealth(pool);
  const state=async(epoch:number,permission_state="rescan_required")=>run("health.set_source_state",{source_type:base.source_type,source_instance_key:base.source_instance_key,source_fingerprint:base.source_fingerprint,sync_epoch:epoch,permission_state});
  await state(2);
  const scan={...base,sync_epoch:2,previous_cursor:"cursor-1",next_cursor:"scan-2",rescan:window,records:[{...a,record_version:2,payload:{...a.payload,steps:150}}]};
  await assert.rejects(()=>run("health.ingest_batch",{...scan,rescan:undefined}),/complete bounded rescan/);
  await assert.rejects(()=>run("health.ingest_batch",{...scan,rescan:{...window,complete:false}}));
  await assert.rejects(()=>run("health.ingest_batch",{...scan,permission_fingerprint:"changed"}),/fingerprint/);
  assert.equal((await pool.query("select count(*)::int n from health_daily_activity where effective")).rows[0].n,3);
  assert.equal((await pool.query("select permission_state from health_source_instances")).rows[0].permission_state,"rescan_required");
  const cmd=command("health.ingest_batch",scan);await executor.execute(context,cmd);assert.equal((await executor.execute(context,cmd)).replayed,true);await processPendingHealth(pool);
  assert.deepEqual((await pool.query("select steps from health_daily_activity where effective order by steps")).rows.map(x=>x.steps),[150,300]);
  assert.equal((await pool.query("select complete,jsonb_array_length(absent_ids) n from health_rescan_generations")).rows[0].n,1);
  await assert.rejects(()=>run("health.ingest_batch",{...scan,previous_cursor:"scan-2",next_cursor:"scan-reuse"}),/already completed/);
  await state(3);
  await run("health.ingest_batch",{...base,sync_epoch:3,previous_cursor:"scan-2",next_cursor:"scan-3",records:[b],rescan:{...window,generation:"hcscan_regression_0003"}});await processPendingHealth(pool);
  assert.deepEqual((await pool.query("select steps from health_daily_activity where effective order by steps")).rows.map(x=>x.steps),[200,300]); // unchanged provider version may reappear in a newer complete generation
  await state(4,"revoked");
  await assert.rejects(()=>run("health.ingest_batch",{...base,sync_epoch:4,previous_cursor:"scan-3",next_cursor:"scan-4",records:[],rescan:{...window,generation:"hcscan_regression_0004"}}),/revoked permission/);
  await run("health.ingest_batch",{...base,sync_epoch:5,previous_cursor:"scan-3",next_cursor:"scan-5",records:[],rescan:{...window,generation:"hcscan_regression_0005"}});await processPendingHealth(pool);
  assert.deepEqual((await pool.query("select steps from health_daily_activity where effective")).rows.map(x=>x.steps),[300]);
  await state(6);
  const reappeared=await run("health.ingest_raw",{source_type:base.source_type,source_instance_key:base.source_instance_key,source_fingerprint:base.source_fingerprint,record_type:base.record_type,sync_epoch:6,parse_version:base.parse_version,...b});
  assert.equal(reappeared.actual_values.state,"pending");
  assert.equal((await pool.query("select permission_state from health_source_instances")).rows[0].permission_state,"rescan_required");
});

test("F07/F08: complete interval upgrade retires only covered legacy HC totals",pgOnly,async t=>{
  const {pool,run}=await reviewFixture(t);
  const legacy={...base,record_type:"daily_activity",records:[{client_record_id:"old_encoding",record_version:1,change_kind:"upsert",payload:{occurred_on:"2026-09-10",time_zone:"UTC",steps:200}}]};
  await run("health.ingest_batch",legacy);await processPendingHealth(pool);
  await run("health.ingest_batch",{...base,rescan:window,records:[steps("old_encoding","2026-09-10T01:00:00Z","2026-09-10T02:00:00Z",100)]});await processPendingHealth(pool);
  assert.deepEqual((await pool.query("select steps from health_daily_activity where effective")).rows.map(x=>x.steps),[100]);
  assert.equal((await pool.query("select count(*)::int n from health_raw_revisions")).rows[0].n,2);
  await assert.rejects(()=>run("health.ingest_batch",{...legacy,previous_cursor:null,next_cursor:"old-return"}),/interval encoding/);
});

test("F08: unknown coverage and oversized or failed scans cannot mark a source complete",pgOnly,async t=>{
  const {pool,run}=await reviewFixture(t);
  await run("health.ingest_batch",{...base,records:[{client_record_id:"unknown_shape",record_version:1,change_kind:"upsert",payload:{unrecognized:true}}]});
  await run("health.set_source_state",{source_type:base.source_type,source_instance_key:base.source_instance_key,source_fingerprint:base.source_fingerprint,sync_epoch:2,permission_state:"rescan_required"});
  const scan={...base,sync_epoch:2,previous_cursor:"cursor-1",next_cursor:"scan-failed",rescan:window,records:[]};
  await assert.rejects(()=>run("health.ingest_batch",scan),/cannot establish coverage/);
  await assert.rejects(()=>run("health.ingest_batch",{...scan,records:[{client_record_id:"bad_new",record_version:1,change_kind:"upsert",payload:{steps:1}}]}),/unknown coverage/);
  await assert.rejects(()=>run("health.ingest_batch",{...scan,records:Array.from({length:1001},(_,i)=>steps(`too_many_${i}`,"2026-09-10T01:00:00Z","2026-09-10T02:00:00Z",1))}));
  assert.equal((await pool.query("select count(*)::int n from health_rescan_generations")).rows[0].n,0);
  assert.equal((await pool.query("select permission_state from health_source_instances")).rows[0].permission_state,"rescan_required");
  assert.equal((await pool.query("select cursor from health_sync_cursors")).rows[0].cursor,"cursor-1");
});
