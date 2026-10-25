import assert from "node:assert/strict";
import test from "node:test";
import { processPendingHealth } from "../src/index.js";
import { reviewFixture,pgOnly } from "./review-fixture.js";

const base={source_type:"health_connect",source_instance_key:"review-health-device",source_fingerprint:"permission-review",device_id:"review-health-device",record_type:"steps_interval",permission_fingerprint:"permission-review",sync_epoch:1,previous_cursor:null,next_cursor:"cursor-1",parse_version:"health-connect-2"};
function steps(id:string,start:string,end:string,count:number,origin="example.provider",version=1){return{client_record_id:id,provider_record_id:id,record_version:version,change_kind:"upsert",payload:{occurred_on:start.slice(0,10),time_zone:"UTC",steps:count,step_interval:{started_at:start,ended_at:end,data_origin:origin},field_sources:{steps:`health_connect:${origin}`}}};}
const window={generation:"hcscan_regression_0001",window_start:"2026-09-01T00:00:00Z",window_end:"2026-09-11T00:00:00Z",complete:true};

test("device sources can refresh volatile fingerprints without stranding a same-epoch queue",pgOnly,async t=>{
  const {pool,run}=await reviewFixture(t);
  const record={source_type:"samsung",source_instance_key:"android-samsung-device",source_fingerprint:"permission-snapshot-a",record_type:"body",client_record_id:"samsung-heart-2026-09-10",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"samsung-data-1",payload:{occurred_on:"2026-09-10",time_zone:"UTC",group_kind:"measurement",observations:[{metric_key:"heart_rate",value:"60",unit:"bpm"}]}};
  await run("health.ingest_raw",record);
  await run("health.ingest_raw",{...record,source_fingerprint:"permission-snapshot-b",record_version:2,payload:{...record.payload,observations:[{metric_key:"heart_rate",value:"61",unit:"bpm"}]}});
  assert.deepEqual((await pool.query("select fingerprint,sync_epoch,current_version::text from health_source_instances source join health_raw_records raw on raw.source_instance_id=source.id")).rows[0],{fingerprint:"permission-snapshot-b",sync_epoch:1,current_version:"2"});

  const strict={...record,source_type:"health_connect",source_instance_key:"strict-health-connect",client_record_id:"strict-record"};
  await run("health.ingest_raw",strict);
  await assert.rejects(()=>run("health.ingest_raw",{...strict,source_fingerprint:"permission-snapshot-b",record_version:2}),/newer sync epoch/);
});

test("provider-native archive payloads are retained without creating duplicate projections",pgOnly,async t=>{
  const {pool,run}=await reviewFixture(t);
  const payload={samsung_data_type:"com.samsung.health.heart_rate",sdk_schema_version:"1.1.0",uid:"heart-archive-1",fields:{heart_rate:72,series_data:[{heart_rate:71,start_time:"2026-09-10T01:00:00Z",end_time:"2026-09-10T01:01:00Z"}]}};
  await run("health.ingest_raw",{source_type:"samsung",source_instance_key:"android-samsung-archive",source_fingerprint:"permission-archive",record_type:"archive",client_record_id:"samsung-archive-heart-1",provider_record_id:"heart-archive-1",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"samsung-data-4",payload});
  const result=await processPendingHealth(pool);
  assert.equal(result[0]?.state,"completed");
  assert.deepEqual((await pool.query("select revision.payload from health_raw_records raw join health_raw_revisions revision on revision.raw_id=raw.id and revision.record_version=raw.current_version where raw.client_record_id='samsung-archive-heart-1'")).rows[0].payload,payload);
  assert.equal((await pool.query("select (select count(*) from health_observations)+(select count(*) from health_daily_activity)+(select count(*) from health_workout_sessions) n")).rows[0].n,"0");
});

test("Samsung takeoff records become release habits and can move back to workouts",pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t);
  const record={source_type:"samsung",source_instance_key:"android-samsung-release",source_fingerprint:"permission-release",record_type:"workout",client_record_id:"samsung-exercise-release",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"samsung-data-2",payload:{occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",session_type:"release",started_at:"2026-09-10T10:00:00Z",duration_minutes:5,detail:{source:"samsung_health",provider_type:"OTHER",custom_title:"起飞",excluded_from_activity:true}}};
  await run("health.ingest_raw",record);await processPendingHealth(pool);
  assert.equal((await pool.query("select count(*)::int n from health_workout_sessions where effective")).rows[0].n,0);
  assert.deepEqual((await pool.query("select habit_key,done_count,effective from health_habit_logs")).rows[0],{habit_key:"release",done_count:1,effective:true});
  const releaseId=(await pool.query("select id from health_habit_logs where effective")).rows[0].id;
  assert.equal((await queries.healthRecord(context,releaseId) as {kind:string}).kind,"habit_log");

  await run("health.ingest_raw",{...record,record_version:2,payload:{...record.payload,session_type:"running",detail:{source:"samsung_health",provider_type:"RUNNING",excluded_from_activity:false}}});await processPendingHealth(pool);
  assert.equal((await pool.query("select count(*)::int n from health_workout_sessions where effective and session_type='running'")).rows[0].n,1);
  assert.equal((await pool.query("select count(*)::int n from health_habit_logs where effective")).rows[0].n,0);
  assert.equal((await queries.healthRecord(context,releaseId) as {kind:string}).kind,"workout_session");

  await run("health.ingest_raw",{...record,record_version:3,payload:{...record.payload,session_type:"other",detail:{source:"samsung_health",provider_type:"OTHER",custom_title:"起飞"}}});await processPendingHealth(pool);
  assert.equal((await pool.query("select count(*)::int n from health_workout_sessions where effective")).rows[0].n,0);
  assert.equal((await pool.query("select count(*)::int n from health_habit_logs where effective and habit_key='release'")).rows[0].n,1);
});

test("historical migration sources are not actionable sync issues",pgOnly,async t=>{
  const {pool,queries,context}=await reviewFixture(t);
  await pool.query("insert into health_source_instances(id,subject_id,source_type,instance_key,permission_state,sync_epoch) values('healthsource_historical_review',$1,'legacy_health','legacy-history','historical',1)",[context.subjectId]);
  const view=await queries.lifeToday(context,{date:"2026-09-10",time_zone:"Asia/Shanghai"}) as {domains:{health:{sync_issues:Array<{source_type:string}>}}};
  assert.deepEqual(view.domains.health.sync_issues,[]);
});

test("workout duration supplies active minutes and body detail returns the complete measurement",pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t);
  await run("health.ingest_raw",{source_type:"samsung",source_instance_key:"android-samsung-complete",source_fingerprint:"permission-complete",record_type:"workout",client_record_id:"samsung-exercise-active",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"samsung-data-3",payload:{occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",session_type:"walking",started_at:"2026-09-10T02:00:00Z",duration_minutes:42,detail:{source:"samsung_health"}}});
  await run("health.ingest_raw",{source_type:"scale",source_instance_key:"android-scale-complete",source_fingerprint:"scale-complete",record_type:"body",client_record_id:"scale-complete",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"xiaomi-ble-2",payload:{occurred_on:"2026-09-10",occurred_at:"2026-09-10T02:30:00Z",time_zone:"Asia/Shanghai",group_kind:"measurement",observations:[{metric_key:"weight",value:"85.700000",unit:"kg",original_field:"S400:weight",autofilled:false},{metric_key:"body_fat",value:"27.400000",unit:"%",original_field:"xiaomi-bia-v1",autofilled:true},{metric_key:"impedance_low",value:"503.000000",unit:"ohm",original_field:"S400:impedance_low",autofilled:false}]}});
  await processPendingHealth(pool);
  const daily=await queries.healthDaily(context,"2026-09-10") as {result:{activity:{active_minutes:number};workouts:Array<{time_zone?:string}>}};
  assert.equal(daily.result.activity.active_minutes,42);
  assert.equal(daily.result.workouts[0]?.time_zone,"Asia/Shanghai");
  const observationId=(await pool.query("select id from health_observations where metric_key='weight' and effective")).rows[0].id;
  const detail=await queries.healthRecord(context,observationId) as {fact:{related_observations:Array<{metric_key:string}>};source:{kind:string}};
  assert.deepEqual(detail.fact.related_observations.map(item=>item.metric_key),["weight","body_fat","impedance_low"]);
  assert.equal(detail.source.kind,"scale");
});

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

test("release history uses effective normalized facts, exact provider revision and subject bounds",pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t);
  const base={source_type:"samsung",source_instance_key:"release-display",source_fingerprint:"permission-display",record_type:"workout",record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"samsung-data-4"};
  const first={...base,client_record_id:"release-display-1",payload:{occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",session_type:"release",started_at:"2026-09-10T10:00:00Z",duration_minutes:5}};
  await run("health.ingest_raw",first);
  await run("health.ingest_raw",{...base,client_record_id:"release-display-2",payload:{...first.payload,started_at:"2026-09-10T11:00:00Z"}});
  await run("health.ingest_raw",{...base,client_record_id:"release-display-other-month",payload:{...first.payload,occurred_on:"2026-08-10",started_at:"2026-08-10T11:00:00Z"}});
  await run("health.ingest_raw",{...base,record_type:"habit",client_record_id:"release-display-denial",payload:{occurred_on:"2026-09-11",time_zone:"Asia/Shanghai",habit_key:"release",done_count:0,explicit_denial:true}});
  await processPendingHealth(pool);
  const input={from:"2026-09-01",to:"2026-09-30",limit:1000};
  const history=await queries.healthReleaseHistory(context,input);
  assert.equal(history.total_count,2);assert.equal(history.recorded_days,1);assert.equal(history.latest_on,"2026-09-10");assert.equal(history.items.length,3);
  assert.equal(history.items[0]?.started_at,null);assert.equal(history.items[0]?.explicit_denial,true);
  assert.equal(history.items[1]?.started_at,"2026-09-10T11:00:00Z");assert.equal(history.items[1]?.duration_minutes,5);
  const limited=await queries.healthReleaseHistory(context,{...input,limit:1});assert.equal(limited.total_count,2);assert.equal(limited.items.length,1);assert.equal(limited.truncated,true);
  await assert.rejects(()=>queries.healthReleaseHistory({...context,effects:new Set()},input),/permission|denied|effect/i);
  assert.equal((await queries.healthReleaseHistory({...context,subjectId:"other-subject"},input)).items.length,0);
  await assert.rejects(()=>queries.healthReleaseHistory(context,{...input,to:"2026-08-01"}));
  await assert.rejects(()=>queries.healthReleaseHistory(context,{...input,to:"2028-01-01"}));
  await run("health.ingest_raw",{...first,record_version:2,payload:{...first.payload,duration_minutes:50}});
  assert.equal((await queries.healthReleaseHistory(context,input)).items.find(item=>item.started_at===first.payload.started_at)?.duration_minutes,5);
  await processPendingHealth(pool);
  assert.equal((await queries.healthReleaseHistory(context,input)).items.find(item=>item.started_at===first.payload.started_at)?.duration_minutes,50);
  await run("health.ingest_raw",{...first,record_version:3,payload:{...first.payload,session_type:"running"}});await processPendingHealth(pool);
  assert.equal((await queries.healthReleaseHistory(context,input)).total_count,1);
  await run("health.ingest_raw",{...base,client_record_id:"release-display-2",record_version:2,change_kind:"delete"});await processPendingHealth(pool);
  const remaining=await queries.healthReleaseHistory(context,input);assert.equal(remaining.total_count,0);assert.equal(remaining.latest_on,null);assert.equal(remaining.items.length,1);
});

test("health trends preserve Samsung extrema and temperature measurement context",pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t);
  await run("health.ingest_raw",{source_type:"samsung",source_instance_key:"context-display",source_fingerprint:"permission-context",record_type:"body",client_record_id:"context-body",parse_version:"samsung-data-4",record_version:1,sync_epoch:1,change_kind:"upsert",payload:{occurred_on:"2026-09-10",time_zone:"UTC",group_kind:"measurement",observations:[{metric_key:"heart_rate",value:"49",unit:"bpm",original_field:"samsung:daily_min"},{metric_key:"heart_rate",value:"158",unit:"bpm",original_field:"samsung:daily_max"},{metric_key:"temperature",value:"32.5",unit:"°C",original_field:"samsung:skin_temperature"}]}});
  await processPendingHealth(pool);
  const heart=await queries.healthTrend(context,{metric_key:"heart_rate",limit:100});
  assert.deepEqual(heart.points.map(point=>point.original_field).sort(),["samsung:daily_max","samsung:daily_min"]);
  const skin=await queries.healthTrend(context,{metric_key:"temperature",limit:100});assert.equal(skin.points[0]?.original_field,"samsung:skin_temperature");
});
