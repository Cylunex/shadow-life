import test from "node:test";
import assert from "node:assert/strict";
import {pgOnly,reviewFixture} from "./review-fixture.js";

test("subject-scoped containers, report observations, episodes and manual day union",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const a=String((await run("life.save_container",{label:"柜顶"})).actual_values.container_id);
  const b=String((await run("life.save_container",{label:"蓝箱",parent_id:a})).actual_values.container_id);
  await assert.rejects(()=>run("life.save_container",{id:a,label:"柜顶",expected_revision:1,parent_id:b}));
  const item=String((await run("life.save_owned_item",{name:"充电器",ownership_state:"owned",location:"抽屉"})).resources.find(r=>r.type==="owned_item")!.id);
  await run("life.place_item",{item_id:item,expected_revision:1,container_id:b});
  assert.deepEqual((await queries.containers(context,{query:"充电器"})).items[0]?.path,["柜顶","蓝箱"]);
  await run("life.save_container",{id:b,label:"蓝箱",expected_revision:1,parent_id:null});
  assert.deepEqual((await queries.containers(context,{container_id:b})).items[0]?.path,["蓝箱"]);
  const report=await run("library.capture",{title:"合成报告",item_type:"note",text:"测试项目",tags:[]});
  const lab={report_id:report.actual_values.library_item_id,report_revision:1,page:1,tested_on:"2026-11-01",raw_name:"合成指标",value:"阴性"};
  const one=await run("health.save_lab_result",lab),two=await run("health.save_lab_result",{...lab,page:2,value:"6.5",unit:"mmol/L",reference:"按原报告"});
  assert.equal((await queries.labResults(context,{left_id:one.actual_values.id,right_id:two.actual_values.id})).items.length,2);
  const ep={title:"头痛",started_on:"2026-11-11",started_at:"2026-11-11T23:45:00+08:00",time_zone:"Asia/Shanghai"};
  const start=await run("health.save_episode",ep);
  await run("health.save_episode",{...ep,id:start.actual_values.id,expected_revision:1,ended_on:"2026-11-12",ended_at:"2026-11-12T00:15:00+08:00"});
  assert.equal((await queries.episodes(context,{from:"2026-11-12"})).items[0]?.duration_minutes,30);
  const interval={title:"散步",time_zone:ep.time_zone,started_at:"2026-11-11T22:00:00+08:00",ended_at:"2026-11-12T00:00:00+08:00"};
  const span=await run("life.save_offline_interval",interval);
  await run("life.save_offline_interval",{...interval,id:span.actual_values.id,expected_revision:1,ended_at:"2026-11-11T22:30:00+08:00"});
  await run("life.save_offline_interval",{...interval,started_at:"2026-11-11T22:20:00+08:00",ended_at:"2026-11-11T22:45:00+08:00"});
  assert.equal((await queries.offlineDay(context,{date:"2026-11-11",time_zone:ep.time_zone})).active_minutes,45);
  assert.equal((await queries.containers({...context,subjectId:"subject_elsewhere"},{container_id:b})).items.length,0);
});

test("rail confirmation, private diary and a twelve second clip retain their sources",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const {AssetService}=await import("../src/asset-service.js");
  const {actual_values:{trip_id}}=await run("travel.create_trip",{title:"合成旅行",starts_on:"2026-11-01",ends_on:"2026-11-07",time_zone:"Asia/Shanghai"});
  const {actual_values:{library_item_id}}=await run("library.capture",{title:"铁路确认单",item_type:"note",text:"订单号：E123456789\n2026年11月2日 车次 G100 次\n发站：北京南 到站：上海虹桥\n发车时间 09:10 票价：￥550.00",tags:[]});
  const ticket=await queries.railTicket(context,{trip_id,library_item_id});
  assert.equal(ticket.starts_at,"2026-11-02T09:10:00+08:00");assert.equal(ticket.printed_fare,"550.00");assert.equal(ticket.destination,"上海虹桥");
  await run("travel.add_reservation",{trip_id,title:ticket.service_number,reservation_type:"rail",confirmation_code:ticket.confirmation_code,starts_at:ticket.starts_at});
  assert.equal((await queries.railTicket(context,{trip_id,library_item_id})).matched.length,1);
  assert.equal((await pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
  const {asset_version_id}=await new AssetService(pool).store(context.subjectId,"audio/wav",Buffer.from("test audio"));
  const segment_id="audio_private_001";
  await run("life.register_recording",{segment_id,session_id:"recording_private_001",segment_index:0,title:"站台",started_at:"2026-11-02T00:00:00Z",ended_at:"2026-11-02T00:01:00Z",time_zone:"UTC",asset_version_id});
  await pool.query("update capture_recording_segments set spans=$1::jsonb where id=$2",[JSON.stringify([{start_ms:500,end_ms:11500,text:"合成转写"}]),segment_id]);
  await run("life.save_clip",{segment_id,start_ms:0,end_ms:12000,title:"站台广播"});
  await run("travel.save_diary_entry",{trip_id,local_day:"2026-11-02",body:"出发",refs:[{kind:"audio",id:segment_id}]});
  assert.equal((await queries.tripDiary(context,{trip_id})).items[0]?.refs[0]?.id,segment_id);
  const range={from:"2026-11-01",to:"2026-11-07",time_zone:"Asia/Shanghai"};
  assert.equal((await queries.clips(context,range)).items[0]?.asset_version_id,asset_version_id);
  await pool.query("update capture_recording_segments set deleted_at=now(),spans='[]' where id=$1",[segment_id]);
  const clip=(await queries.clips(context,range)).items[0];assert.equal(clip?.asset_version_id,null);assert.equal(clip?.quote,"合成转写");
  assert.deepEqual((await queries.tripDiary(context,{trip_id})).items[0]?.refs,[]);
  await run("library.save_filter",{name:"票据",query:"铁路"});
  assert.equal((await queries.librarySavedFilters(context,{})).items[0]?.query,"铁路");
});
test("formal expense totals include duplicate candidates with missing times and distinguish periods",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const fact={occurred_on:"2026-11-02",time_zone:"Asia/Shanghai",entry_type:"expense",amount:"19.00",currency:"CNY"};
  await run("money.record_entry",fact);await run("money.record_entry",{...fact,occurred_at:"2026-11-02T12:30:00+08:00"});
  await run("money.record_entry",{...fact,occurred_on:"2026-10-25"});
  const r=await queries.reconcileExpenses(context,{from:"2026-11-01",to:"2026-11-07"});
  assert.equal(r.confirmed_expenses,2);assert.equal(Number(r.gross_amount),38);assert.equal(r.items[0]?.basis,"same_day_amount");
  assert.equal(r.items[0]?.records.filter(x=>x.occurred_at===null).length,1);
});
test("route comparisons separate duration bases and evening sleep keeps missing data visible",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const base={occurred_on:"2026-11-01",time_zone:"Asia/Shanghai",session_type:"run",duration_minutes:30,distance_km:"5"};
  for(const [type,basis,time] of [["run","moving","2026-11-01T23:45:00+08:00"],["walk","elapsed","2026-11-01T17:00:00+08:00"]]){
    const receipt=await run("health.record_workout",{...base,session_type:type,started_at:time});
    const workout_id=receipt.resources.find(r=>r.type==="health_workout_session")!.id;
    await run("health.set_workout_route",{workout_id,route:"河岸",duration_basis:basis});
  }
  const r=await queries.routeComparison(context,{route:"河岸",session_type:"run",duration_basis:"moving"});
  assert.equal(r.items.length,1);assert.equal(Number(r.items[0]?.minutes_per_km),6);
  await run("health.set_rest_day",{occurred_on:"2026-11-02",time_zone:base.time_zone,is_rest:true});
  const sleep=await queries.eveningSleep(context,{from:"2026-11-01",to:"2026-11-03",time_zone:base.time_zone});
  assert.deepEqual(sleep.days.map(d=>d.group),["evening","rest","unknown"]);
  assert.equal(sleep.evening.missing,1);assert.equal(sleep.rest.samples,0);
});
test("exercise history bypasses unrelated sessions with one bounded query",pgOnly,async t=>{
  const {pool,queries,context}=await reviewFixture(t);
  const exercise={id:"push_up",equipment:"bodyweight",unit:"reps"} as const;
  await pool.query(`insert into health_workout_sessions(id,subject_id,occurred_on,time_zone,session_type,detail)
    select 'workout_bench_'||lpad(n::text,5,'0'),$1,date '2020-01-01'+n,'UTC','strength_training',
    jsonb_build_object('strength_session',jsonb_build_object('version',1,'exercises',jsonb_build_array(
    jsonb_build_object('exercise',jsonb_build_object('id',case when n<=3 then 'push_up' else 'other_exercise' end,
    'equipment','bodyweight','unit','reps'),'sets','[{"reps":8}]'::jsonb)))) from generate_series(1,303)n`,[context.subjectId]);
  let requests=0,cursor:string|null=null,found=false;
  const start=performance.now();
  do{
    const page=await queries.listDomain(context,"health",{limit:50,...(cursor?{cursor}:{})});requests++;
    for(const row of page.items){
      if(row.kind!=="workout_session")continue;
      const record=await queries.healthRecord(context,row.id);requests++;
      if(row.id<="workout_bench_00003"&&record){found=true;break;}
    }
    cursor=page.next_cursor;
  }while(!found&&cursor);
  const oldMs=performance.now()-start,newStart=performance.now();
  const result=await queries.exerciseHistory(context,exercise);
  const newMs=performance.now()-newStart;assert.equal(result.sessions.length,3);assert.ok(found&&requests>300);
  t.diagnostic(`303 sessions: old ${requests} service calls / ${Math.round(oldMs)} ms; new 1 service call / ${Math.round(newMs)} ms (local PostgreSQL)`);
});
