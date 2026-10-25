import assert from "node:assert/strict";
import test from "node:test";
import { pgOnly, reviewFixture } from "./review-fixture.js";

const date="2026-10-25",timeZone="Asia/Shanghai";
const completeItem={name:"合成半份餐",energy_kcal:"600",protein_g:"30",fat_g:"10",carb_g:"80",consumed_fraction:"0.5"};
const imageOnlyMeal={occurred_on:date,time_zone:timeZone,meal_type:"lunch",items:[],source:{kind:"image",captured_on:date,original_text:"合成图片来源，尚未录入食物条目"}};

test("deleted meals cannot affect daily nutrition, meal coverage or freshness",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const active=await run("life.record_meal",{occurred_on:date,time_zone:timeZone,meal_type:"lunch",items:[completeItem]});
  const deletedWithItems=await run("life.record_meal",{occurred_on:date,time_zone:timeZone,meal_type:"dinner",items:[{name:"已删除条目",energy_kcal:"9000"}]});
  const deletedEmpty=await run("life.record_meal",imageOnlyMeal);
  // Tombstones remain as migration history. Parent state must win even if a historical item is still effective.
  await pool.query("update meals set state='deleted',created_at='2026-10-25T12:00:00Z' where id=any($1::text[])",[[deletedWithItems.actual_values.meal_id,deletedEmpty.actual_values.meal_id]]);
  await pool.query("update meals set created_at='2026-10-25T01:00:00Z' where id=$1",[active.actual_values.meal_id]);
  const operationsBefore=(await pool.query("select count(*)::int n from operations")).rows[0].n;
  const today=await queries.lifeToday(context,{date,time_zone:timeZone,domains:["meals"]});
  const review=await queries.wellnessReview(context,{to:date,days:7});
  assert.equal(today.domains.meals!.count,1);
  assert.equal(Date.parse(today.domains.meals!.freshness!),Date.parse("2026-10-25T01:00:00Z"));
  assert.equal(today.domains.meals!.nutrition!.energy_kcal,"300.000000");
  assert.equal(today.domains.meals!.nutrition!.total_items,1);
  assert.equal(today.domains.meals!.nutrition!.complete_macros,true);
  assert.equal(review.days.at(-1)!.meals,1);
  assert.equal(review.days.at(-1)!.empty_meals,0);
  assert.equal(review.current.items,1);
  assert.equal(review.current.nutrients.energy_kcal.known_total,"300");
  assert.equal(review.current.nutrients.energy_kcal.complete_days,1);
  assert.equal((await pool.query("select count(*)::int n from operations")).rows[0].n,operationsBefore);
});

test("an active empty meal keeps daily macro coverage incomplete until facts are added",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  await run("life.record_meal",{occurred_on:date,time_zone:timeZone,meal_type:"breakfast",items:[completeItem]});
  const empty=await run("life.record_meal",imageOnlyMeal);
  const read=()=>queries.lifeToday(context,{date,time_zone:timeZone,domains:["meals"]});
  let today=await read();
  assert.equal(today.domains.meals!.count,2);
  assert.equal(today.domains.meals!.nutrition!.energy_kcal,"300.000000");
  assert.equal(today.domains.meals!.nutrition!.complete_macros,false);
  assert.equal((await queries.wellnessReview(context,{to:date,days:7})).current.nutrients.protein_g.complete_days,0);
  // Explicit zero is known; it may complete the recorded facts without changing the known total.
  await run("life.add_intake",{meal_id:empty.actual_values.meal_id,expected_meal_revision:1,item:{name:"水",energy_kcal:"0",protein_g:"0",fat_g:"0",carb_g:"0"},reason:"补充实际食物与标签营养"});
  today=await read();
  assert.equal(today.domains.meals!.nutrition!.complete_macros,true);
  assert.equal(today.domains.meals!.nutrition!.total_items,2);
  assert.equal(today.domains.meals!.nutrition!.energy_kcal,"300.000000");
  assert.equal((await queries.wellnessReview(context,{to:date,days:7})).current.nutrients.protein_g.complete_days,1);
});

test("empty meal coverage is scoped to the same owner and recorded local date",pgOnly,async t=>{
  const {run,queries,context,unitOfWork}=await reviewFixture(t);
  await run("life.record_meal",{occurred_on:date,time_zone:timeZone,meal_type:"lunch",items:[completeItem]});
  await run("life.record_meal",{...imageOnlyMeal,occurred_on:"2026-10-24"});
  const other={...context,actorId:"subject_other_meal",subjectId:"subject_other_meal"};
  await unitOfWork.ensurePrincipal(other.subjectId);
  await run("life.record_meal",imageOnlyMeal,other);
  const today=await queries.lifeToday(context,{date,time_zone:timeZone,domains:["meals"]});
  assert.equal(today.domains.meals!.count,1);
  assert.equal(today.domains.meals!.nutrition!.complete_macros,true);
  const absent=await queries.lifeToday(context,{date:"2026-10-23",time_zone:timeZone,domains:["meals"]});
  assert.equal(absent.domains.meals!.count,0);
  assert.equal(absent.domains.meals!.nutrition!.energy_kcal,null);
  assert.equal(absent.domains.meals!.nutrition!.complete_macros,false);
});
