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
  const legacy = await queries.lifeRecord(context, String(deletedWithItems.actual_values.meal_id));
  assert.ok(legacy.kind === "meal" && legacy.state === "voided");
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

test("image sources in record_meal default to meal_photo and attach_meal_source upgrades existing photo roles without external_id conflict", pgOnly, async t => {
  const { run, queries, context, pool } = await reviewFixture(t);
  const seedAsset = async (assetId: string, versionId: string) => {
    await pool.query("insert into assets(id,subject_id,media_type) values($1,$2,'image/jpeg')", [assetId, context.subjectId]);
    await pool.query("insert into asset_versions(id,asset_id,sha256,byte_size,storage_key) values($1,$2,$3,12,$4)", [versionId, assetId, `${versionId}_sha`, `test/${versionId}`]);
  };
  await seedAsset("asset_photo_1", "ver_photo_1");
  await seedAsset("asset_photo_2", "ver_photo_2");
  const meal = await run("life.record_meal", {
    occurred_on: date, time_zone: timeZone, meal_type: "lunch",
    items: [completeItem],
    source: { kind: "image", external_id: "qq:msg-photo-1", captured_on: date, original_text: "初版说明", asset_version_id: "ver_photo_1" }
  });
  const mealId = String(meal.actual_values.meal_id);
  const initial = await queries.lifeRecord(context, mealId);
  assert.ok(initial.kind === "meal" && initial.sources?.[0]?.role === "meal_photo");
  // Simulate a legacy row stored with role='evidence' and verify re-tagging succeeds even when metadata differs.
  await pool.query("update meal_source_links set role='evidence' where meal_id=$1", [mealId]);
  const retagged = await run("life.attach_meal_source", {
    meal_id: mealId, expected_meal_revision: 1, role: "meal_photo",
    source: { kind: "image", external_id: "qq:msg-photo-1", captured_on: date, original_text: "补录更正说明", asset_version_id: "ver_photo_1" }
  });
  assert.equal(retagged.actual_values.role, "meal_photo");
  const after = await queries.lifeRecord(context, mealId);
  assert.ok(after.kind === "meal" && after.sources?.length === 1 && after.sources[0]?.role === "meal_photo");
  // Different asset_version_id reusing the same external_id must still fail with conflict.
  await assert.rejects(() => run("life.attach_meal_source", {
    meal_id: mealId, expected_meal_revision: 2, role: "meal_photo",
    source: { kind: "image", external_id: "qq:msg-photo-1", captured_on: date, asset_version_id: "ver_photo_2" }
  }), /different content/);
});

test("life.void_meal soft-voids duplicate meals, preserves revisions, blocks edits, and protects confirmed payments", pgOnly, async t => {
  const { run, queries, context, pool } = await reviewFixture(t);
  const kept = await run("life.record_meal", { occurred_on: date, time_zone: timeZone, meal_type: "lunch", items: [completeItem] });
  const duplicate = await run("life.record_meal", { occurred_on: date, time_zone: timeZone, meal_type: "lunch", items: [completeItem] });
  const dupId = String(duplicate.actual_values.meal_id);
  const voided = await run("life.void_meal", { meal_id: dupId, expected_revision: 1, reason: "重复录入软作废" });
  assert.equal(voided.actual_values.state, "voided");
  assert.equal(voided.actual_values.revision, 2);
  const detail = await queries.lifeRecord(context, dupId);
  assert.ok(detail.kind === "meal" && detail.state === "voided" && detail.revision === 2);
  assert.equal((await pool.query("select count(*)::int n from meal_revisions where meal_id=$1", [dupId])).rows[0].n, 1);
  const meals = await queries.listMeals(context, { occurred_on: date, limit: 10 });
  assert.deepEqual(meals.items.map(item => item.id), [String(kept.actual_values.meal_id)]);
  const today = await queries.lifeToday(context, { date, time_zone: timeZone, domains: ["meals"] });
  assert.equal(today.domains.meals!.count, 1);
  // Voided meals cannot be voided again or edited.
  await assert.rejects(() => run("life.void_meal", { meal_id: dupId, expected_revision: 2, reason: "再次作废" }), /already voided|revision/);
  await assert.rejects(() => run("life.correct_meal", { meal_id: dupId, expected_revision: 2, occurred_on: date, time_zone: timeZone, meal_type: "dinner", reason: "改已作废餐" }), /meal/);
  // Meals with a confirmed direct payment cannot be voided independently.
  const paid = await run("life.record_meal", {
    occurred_on: date, time_zone: timeZone, meal_type: "dinner",
    items: [completeItem],
    payment: { amount: "20.00", currency: "CNY", occurred_on: date, time_zone: timeZone }
  });
  await assert.rejects(() => run("life.void_meal", { meal_id: String(paid.actual_values.meal_id), expected_revision: 1, reason: "有实付不应直接作废" }), /confirmed linked payment/);
  const expense = await run("money.record_entry", {
    occurred_on: date, time_zone: timeZone, entry_type: "expense", currency: "CNY", amount: "12.00"
  });
  const linked = await run("life.record_meal", {
    occurred_on: date, time_zone: timeZone, meal_type: "lunch", items: [completeItem],
    existing_consumption: { record_id: expense.actual_values.record_id, expected_record_revision: 1 }
  });
  await assert.rejects(() => run("life.void_meal", {
    meal_id: linked.actual_values.meal_id, expected_revision: 1, reason: "复用付款的餐次"
  }), /confirmed linked payment/);
});

test("voiding a paid duplicate keeps both confirmed expenses on the retained meal", pgOnly, async t => {
  const { run, queries, context } = await reviewFixture(t);
  const mealInput = { occurred_on: date, time_zone: timeZone, items: [completeItem] };
  const kept = await run("life.record_meal", { ...mealInput, meal_type: "lunch" });
  const duplicate = await run("life.record_meal", { ...mealInput, meal_type: "other" });
  const keptId = String(kept.actual_values.meal_id), duplicateId = String(duplicate.actual_values.meal_id);
  const saveExpense = async (amount: string) => String((await run("money.record_entry", {
    occurred_on: date, time_zone: timeZone, entry_type: "expense", currency: "CNY", amount
  })).actual_values.record_id);
  const link = (meal_id: string, consumption_record_id: string) => run("life.link_meal_consumption", {
    meal_id, consumption_record_id, evidence: "user_confirmed"
  });
  const comboId = await saveExpense("26.00"), addOnId = await saveExpense("30.00");
  await link(keptId, comboId);
  await link(duplicateId, addOnId);
  const voidInput = { meal_id: duplicateId, retained_meal_id: keptId, expected_revision: 1, reason: "作废同一餐的零摄入占位" };
  await assert.rejects(() => run("life.void_meal", voidInput), /confirmed linked payment/);
  await link(keptId, addOnId);

  const before = await queries.lifeRecord(context, addOnId);
  assert.ok(before.kind === "record" && before.meals?.length === 2);
  const receipt = await run("life.void_meal", voidInput);
  assert.equal(receipt.actual_values.retained_meal_id, keptId);
  const historical = await queries.lifeRecord(context, duplicateId);
  assert.ok(historical.kind === "meal" && historical.state === "voided");
  const meals = await queries.listMeals(context, { occurred_on: date, limit: 10 });
  assert.deepEqual(meals.items.map(meal => meal.id), [keptId]);
  for (const [recordId, amount] of [[comboId, 26], [addOnId, 30]] as const) {
    const record = await queries.lifeRecord(context, recordId);
    assert.ok(record.kind === "record" && record.state === "confirmed");
    assert.equal(Number(record.money_entry?.amount), amount);
    assert.deepEqual(record.meals?.map(meal => meal.id), [keptId]);
  }
});

test("competing duplicate voids cannot both remove the meal linked to a payment", pgOnly, async t => {
  const { run, queries, context } = await reviewFixture(t);
  const first = await run("life.record_meal", {
    occurred_on: date, time_zone: timeZone, meal_type: "other", items: [completeItem],
    payment: { amount: "30.00", currency: "CNY", occurred_on: date, time_zone: timeZone }
  });
  const second = await run("life.record_meal", {
    occurred_on: date, time_zone: timeZone, meal_type: "lunch", items: [completeItem]
  });
  const firstId = String(first.actual_values.meal_id), secondId = String(second.actual_values.meal_id);
  const recordId = first.resources.find(resource => resource.type === "consumption_record")!.id;
  await run("life.link_meal_consumption", { meal_id: secondId, consumption_record_id: recordId, evidence: "user_confirmed" });
  const voidMeal = (meal_id: string, retained_meal_id: string) => run("life.void_meal", {
    meal_id, retained_meal_id, expected_revision: 1, reason: "合成重复餐次"
  });
  const results = await Promise.allSettled([voidMeal(firstId, secondId), voidMeal(secondId, firstId)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const record = await queries.lifeRecord(context, recordId);
  assert.ok(record.kind === "record" && record.meals?.length === 1);
  assert.equal(record.meals[0]!.id, results[0]!.status === "fulfilled" ? secondId : firstId);
});

test("racing a confirmed expense link with a meal void commits exactly one", pgOnly, async t => {
  const { run, queries, context } = await reviewFixture(t);
  const expense = await run("money.record_entry", {
    occurred_on: date, time_zone: timeZone, entry_type: "expense", currency: "CNY", amount: "8.00"
  });
  const meal = await run("life.record_meal", { occurred_on: date, time_zone: timeZone, meal_type: "lunch", items: [completeItem] });
  const mealId = String(meal.actual_values.meal_id), recordId = String(expense.actual_values.record_id);
  const results = await Promise.allSettled([
    run("life.void_meal", { meal_id: mealId, expected_revision: 1, reason: "重复记录" }),
    run("life.link_meal_consumption", { meal_id: mealId, consumption_record_id: recordId, evidence: "user_confirmed" })
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const detail = await queries.lifeRecord(context, mealId);
  const record = await queries.lifeRecord(context, recordId);
  assert.ok(detail.kind === "meal" && record.kind === "record");
  assert.equal(detail.state, results[0]!.status === "fulfilled" ? "voided" : "active");
  assert.equal(record.meals?.some(m => m.id === mealId), results[1]!.status === "fulfilled");
  if (results[1]!.status === "rejected") assert.match(String(results[1]!.reason), /active meal/);
});
