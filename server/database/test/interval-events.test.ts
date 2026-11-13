import test from "node:test";
import assert from "node:assert/strict";
import {pgOnly,reviewFixture} from "./review-fixture.js";

test("interval history uses visible live sources, calendar days and stable replay",pgOnly,async t=>{
  const {run,queries,context,executor,command}=await reviewFixture(t);
  const event=await run("life.save_interval_event",{name:"换滤芯"});
  const event_id=event.actual_values.event_id,time_zone="Asia/Shanghai";
  const record=(day:string)=>({event_id,time_zone,occurred_on:"2026-10-"+day});
  const first=command("life.record_occurrence",record("01"));await executor.execute(context,first);await executor.execute(context,first);
  const last=await run("life.record_occurrence",record("13"));
  const read=async(ctx=context)=>(await queries.intervalEvents(ctx,{event_id,as_of:"2026-10-15"})).events[0]!.history;
  assert.deepEqual((await read()).map(x=>[x.days_ago,x.interval_days]),[[2,12],[14,null]]);
  await run("life.record_occurrence",record("06"));await run("life.record_occurrence",record("06"));
  assert.deepEqual((await read()).map(x=>x.interval_days),[7,0,5,null]);
  const card=await run("money.save_service_card",{name:"上门维护",total_units:8,unit_label:"次",started_on:"2026-10-01",time_zone});
  const card_id=card.actual_values.card_id;
  const use=await run("money.record_service_card_use",{card_id,expected_revision:1,occurred_on:"2026-10-14",units:1});
  const linked={event_id,time_zone,source_kind:"service_card_use",source_id:use.actual_values.use_id};
  await run("life.record_occurrence",linked);await assert.rejects(()=>run("life.record_occurrence",linked),/已存在/);
  assert.equal((await read())[0]!.days_ago,1);
  assert.equal((await read({...context,effects:new Set(["life.project.read"])}))[0]!.days_ago,2);
  await run("money.record_service_card_use",{card_id,expected_revision:2,use_id:use.actual_values.use_id,occurred_on:"2026-10-14",units:1,state:"voided",reason:"录错"});
  assert.equal((await read())[0]!.days_ago,2);
  await run("life.record_occurrence",{...record("13"),occurrence_id:last.actual_values.occurrence_id,expected_revision:1,voided:true});
  assert.equal((await read())[0]!.days_ago,9);
  assert.deepEqual((await queries.intervalEvents({...context,subjectId:"subject_other_interval"},{as_of:"2026-10-15"})).events,[]);
});
