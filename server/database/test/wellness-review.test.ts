import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";
import { normalizeHealthRaw } from "../src/index.js";

test("wellness review aggregates actual portions, unknown fields and comparable evidence without writes",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const meal=(date:string,items:unknown[])=>run("life.record_meal",{occurred_on:date,time_zone:"Asia/Shanghai",meal_type:"lunch",items});
  await meal("2026-10-10",[{name:"前期",energy_kcal:"900",protein_g:"30"}]);
  const recorded=await meal("2026-10-17",[{name:"半份",energy_kcal:"600",protein_g:"30",fiber_g:"0",consumed_fraction:"0.5",estimate:true,evidence_note:"合成估算"},{name:"未知菜"}]);
  await meal("2026-10-18",[{name:"水",energy_kcal:"0"}]);
  await meal("2026-10-19",[{name:"标签餐",energy_kcal:"500",protein_g:"20",fat_g:"10",carb_g:"60",sodium_mg:"600"}]);
  const empty=await meal("2026-10-19",[{name:"待移除"}]);
  const emptyItem=(await pool.query("select id from intake_items where meal_id=$1",[empty.actual_values.meal_id])).rows[0].id;
  // Legacy/image-only meals can have no effective item; they must not make a day complete.
  await pool.query("update intake_items set effective=false where id=$1",[emptyItem]);
  await run("health.record_measurement",{metric:"weight",value:"70",unit:"kg",occurred_on:"2026-10-17",occurred_at:"2026-10-17T01:00:00Z",time_zone:"Asia/Shanghai"});
  const latest=await run("health.record_measurement",{metric:"weight",value:"71",unit:"kg",occurred_on:"2026-10-17",occurred_at:"2026-10-17T02:00:00Z",time_zone:"Asia/Shanghai"});
  await run("health.record_measurement",{metric:"weight",value:"150",unit:"lb",occurred_on:"2026-10-18",time_zone:"Asia/Shanghai"});
  await run("health.record_workout",{session_type:"walk",occurred_on:"2026-10-17",time_zone:"Asia/Shanghai",duration_minutes:30});
  await run("health.record_workout",{session_type:"strength_training",occurred_on:"2026-10-17",time_zone:"Asia/Shanghai"});
  for(const [id,minutes] of [["main",420],["nap",30]] as const){
    const raw=await run("health.ingest_raw",{source_type:"health_connect",source_instance_key:"fixture-phone",source_fingerprint:"fixture-permission",record_type:"sleep",client_record_id:id,record_version:1,sync_epoch:1,change_kind:"upsert",payload:{wake_date:"2026-10-17",time_zone:"Asia/Shanghai",total_minutes:minutes},parse_version:"health-normalizer"});
    assert.equal((await normalizeHealthRaw(pool,String(raw.actual_values.raw_id),1)).state,"completed");
  }
  const countBefore=(await pool.query("select count(*)::int n from operations")).rows[0].n;
  const input={to:"2026-10-23",days:7},result=await queries.wellnessReview(context,input);
  const today=await queries.lifeToday(context,{date:"2026-10-17",time_zone:"Asia/Shanghai",domains:["meals"]});
  assert.equal(today.domains.meals?.nutrition?.energy_kcal,"300.000000");
  assert.equal(result.current.from,"2026-10-17");assert.equal(result.previous.to,"2026-10-16");assert.equal(result.days.length,7);
  assert.equal(result.current.nutrients.energy_kcal.known_total,"800");
  assert.equal(result.current.nutrients.energy_kcal.known_items,3);assert.equal(result.current.nutrients.energy_kcal.estimated_items,1);
  assert.equal(result.current.nutrients.energy_kcal.complete_days,1,"partial days and empty meal days cannot enter complete-day means");
  assert.equal(result.current.nutrients.energy_kcal.average_on_complete_days,"0","explicit zero is known, not absent");
  assert.equal(result.current.nutrients.fiber_g.known_total,"0");assert.equal(result.current.nutrients.fat_g.complete_days,0,"zero energy does not manufacture missing macros");
  assert.equal(result.previous.nutrients.energy_kcal.average_on_complete_days,"900");
  assert.equal(result.current.average_weight_kg,"71");assert.equal(result.current.weight_days,1);
  assert.equal(result.current.average_sleep_minutes,420);assert.equal(result.current.sleep_days,1);
  assert.equal(result.current.workout_sessions,2);assert.equal(result.current.known_workout_duration_sessions,1);assert.equal(result.current.workout_minutes,30);
  assert.equal(result.current.paired_energy_weight_days,0);
  assert.equal(result.days[0]!.weight!.id,latest.actual_values.measurement_id);
  assert.equal(result.days[6]!.nutrients.energy_kcal.known_total,null);assert.equal(result.days[6]!.workouts.minutes,null);
  assert.equal((await pool.query("select count(*)::int n from operations")).rows[0].n,countBefore,"review is read-only");
  const other=await queries.wellnessReview({...context,subjectId:"subject_other"},input);
  assert.equal(other.current.items,0);assert.equal(other.current.sleep_days,0);assert.equal(other.current.weight_days,0);
  for(const effects of [new Set<string>(),new Set(["life.meal.read"]),new Set(["health.measurement.read"])])await assert.rejects(()=>queries.wellnessReview({...context,effects},input),/permission/i);
  const item=(await pool.query("select id from intake_items where meal_id=$1 and energy_kcal is not null",[recorded.actual_values.meal_id])).rows[0].id;
  await run("life.correct_intake",{item_id:item,expected_revision:1,item:{name:"更正半份",energy_kcal:"400",consumed_fraction:"0.5"},reason:"核对标签"});
  assert.equal((await queries.wellnessReview(context,input)).current.nutrients.energy_kcal.known_total,"700");
});
