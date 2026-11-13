import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("morning check-ins preserve their first timestamp, isolate sources and pair late sleep",pgOnly,async t=>{
  const {run,context,queries,executor,command,pool}=await reviewFixture(t);
  const wake_date="2026-11-13",time_zone="Asia/Shanghai",filled_at="2026-11-13T00:30:00Z";
  const input={wake_date,time_zone,filled_at,energy_level:0,sleep_quality:null,notes:"晨起"};
  const write=command("health.save_morning_checkin",input);
  await executor.execute(context,write);
  assert.equal((await executor.execute(context,write)).replayed,true);
  await assert.rejects(()=>run("health.save_morning_checkin",input),/晨评已有更新/);
  const get=()=>queries.morningWindow(context,{to:wake_date,time_zone});
  assert.equal((await get()).days.length,14);
  assert.equal((await get()).days[0]!.sleep,null);
  const update={...input,filled_at:"2026-11-13T12:00:00Z",expected_revision:1,notes:"晚间补充"};
  const writes=await Promise.allSettled([run("health.save_morning_checkin",update),run("health.save_morning_checkin",update)]);
  assert.equal(writes.filter(value=>value.status==="fulfilled").length,1);
  const first=(await get()).days[0]!.checkin!;
  assert.equal(first.revision,2); assert.equal(first.energy_level,0);
  assert.equal(Date.parse(first.filled_at),Date.parse(filled_at));
  const source=(await pool.query("select raw_id from health_daily_wellbeing where id=$1",[first.id])).rows[0].raw_id;
  await pool.query("insert into health_sleep_sessions(id,subject_id,raw_id,raw_version,wake_date,time_zone,total_minutes) values('sleep_test_morning',$1,$2,1,$3,$4,450)",[context.subjectId,source,wake_date,time_zone]);
  assert.equal((await get()).days[0]!.sleep?.minutes,450);
  assert.equal((await queries.morningWindow(context,{to:wake_date,time_zone:"UTC"})).days[0]!.checkin,null);
  assert.equal((await queries.morningWindow({...context,subjectId:"subject_other"},{to:wake_date,time_zone})).days[0]!.checkin,null);
  await assert.rejects(()=>queries.morningWindow({...context,effects:new Set()},{to:wake_date,time_zone}),/permission/i);
});
