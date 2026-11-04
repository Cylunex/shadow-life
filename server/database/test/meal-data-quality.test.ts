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

test("correcting a takeout portion preserves the whole-serving evidence and paid order", pgOnly, async t => {
  const { run, queries, context, executor, command } = await reviewFixture(t);
  const dining = await run("life.record_dining", {
    occurred_on: date, time_zone: timeZone, meal_type: "lunch", scene: "delivery",
    consumed_items: [
      { name: "鸡肉饭", quantity: "1", unit: "盒", energy_kcal: "600", protein_g: "30", estimate: true, evidence_note: "整盒营养估算" },
      { name: "水", quantity: "1", unit: "杯", energy_kcal: "0" }
    ],
    purchased_items: [{ raw_name: "鸡肉饭套餐", quantity: "1", unit: "份", line_amount: "28.00" }],
    payment: { amount: "25.00", currency: "CNY", occurred_on: date, time_zone: timeZone },
    sources: [{ kind: "text", role: "receipt", captured_on: date, original_text: "合成订单：优惠后实付25元" }]
  });
  const mealId = String(dining.actual_values.meal_id);
  const orderId = String(dining.actual_values.consumption_record_id);
  const before = await queries.lifeRecord(context, mealId);
  const orderBefore = await queries.lifeRecord(context, orderId);
  assert.ok(before.kind === "meal" && before.items?.length === 2);
  assert.ok(orderBefore.kind === "record" && orderBefore.money_entry?.amount);
  const [rice, water] = before.items;
  const input = { item_id: rice!.id, expected_revision: rice!.revision, consumed_fraction: "0.5", reason: "只吃了半盒饭" };
  const edit = command("life.correct_intake", input);
  const receipt = await executor.execute(context, edit);
  assert.equal(receipt.actual_values.consumed_fraction, "0.5");
  assert.equal((await executor.execute(context, edit)).replayed, true);
  await assert.rejects(() => run("life.correct_intake", input), /revision/);

  const after = await queries.lifeRecord(context, mealId);
  assert.ok(after.kind === "meal" && after.items);
  assert.equal(after.revision, before.revision! + 1);
  assert.deepEqual(after.items[0], { ...rice, revision: rice!.revision + 1, consumed_fraction: after.items[0]!.consumed_fraction });
  assert.equal(Number(after.items[0]!.consumed_fraction), 0.5);
  assert.deepEqual(after.items[1], water);
  assert.deepEqual(after.sources, before.sources);
  const orderAfter = await queries.lifeRecord(context, orderId);
  assert.ok(orderAfter.kind === "record");
  assert.deepEqual(orderAfter.money_entry, orderBefore.money_entry);
  assert.deepEqual(orderAfter.purchase_items, orderBefore.purchase_items);
  assert.equal(orderAfter.revision, orderBefore.revision);
  assert.equal(orderAfter.meals?.[0]?.id, mealId);
  const review = await queries.wellnessReview(context, { to: date, days: 7 });
  assert.equal(review.current.nutrients.energy_kcal.known_total, "300");
});
