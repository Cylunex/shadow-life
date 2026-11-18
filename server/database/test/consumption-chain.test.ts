import assert from "node:assert/strict";
import test from "node:test";
import { pgOnly, reviewFixture, mealInput } from "./review-fixture.js";

const date={occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"};
test("consumption list includes unpaid purchases once and keeps payment-only permissions",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const unpaid=await f.run("life.record_purchase",{...date,scene:"offline_purchase",merchant_name_raw:"未付款示例店",items:[{raw_name:"水果"}]});
  const paid=await f.run("life.record_purchase",{...date,scene:"delivery",merchant_name_raw:"已付款示例店",items:[{raw_name:"米饭"}],payment:{...date,amount:"20.00",currency:"CNY"}});
  const first=await f.queries.listDomain(f.context,"money",{limit:1});
  assert.ok(first.next_cursor);
  const second=await f.queries.listDomain(f.context,"money",{limit:1,cursor:first.next_cursor});
  const rows=[...first.items,...second.items];
  assert.equal(new Set(rows.map(row=>row.record_id)).size,2);
  assert.equal(rows.find(row=>row.record_id===unpaid.actual_values.record_id)?.amount,null);
  assert.equal(rows.filter(row=>row.record_id===paid.actual_values.record_id).length,1);
  const restricted=await f.queries.listDomain({...f.context,effects:new Set(["money.entry.read"])},"money");
  assert.equal(restricted.items.length,1);assert.equal(restricted.items[0]?.kind,"money_entry");
  const searched=await f.queries.listDomain(f.context,"money",{query:"未付款示例店"});
  assert.equal(searched.items[0]?.record_id,unpaid.actual_values.record_id);
});

test("a meal linked to payment-only consumption is navigable both ways without double counting",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const payment=await f.run("money.record_entry",{...date,entry_type:"expense",amount:"25.00",currency:"CNY",counterparty:"示例午餐",source:{kind:"text",captured_on:date.occurred_on,original_text:"合成邮件付款凭证"}});
  const meal=await f.run("life.record_meal",mealInput);
  await f.run("life.link_meal_consumption",{meal_id:meal.actual_values.meal_id,consumption_record_id:payment.actual_values.record_id,evidence:"user_confirmed"});
  const detail=await f.queries.lifeRecord(f.context,payment.actual_values.record_id as string);
  assert.ok(detail.kind==="record");assert.equal(detail.meals?.[0]?.id,meal.actual_values.meal_id);
  assert.equal(detail.sources?.[0]?.original_text,"合成邮件付款凭证");
  const reverse=await f.queries.lifeRecord(f.context,meal.actual_values.meal_id as string);
  assert.equal(reverse.related_records?.[0]?.id,payment.actual_values.record_id);
  assert.match(reverse.related_records![0]!.supporting,/手动确认关联/);
  const restricted=await f.queries.lifeRecord({...f.context,effects:new Set(["life.meal.read"])},meal.actual_values.meal_id as string);
  assert.deepEqual(restricted.related_records,[]);
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
  assert.equal((await f.pool.query("select count(*)::int n from meals")).rows[0].n,1);
});

test("direct meal payment exposes its original and voided facts cannot create new links",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const meal=await f.run("life.record_meal",{...mealInput,source:{kind:"text",captured_on:date.occurred_on,original_text:"合成手动午餐"},payment:{...date,amount:"12.00",currency:"CNY",note:"合成付款"}});
  const recordId=meal.actual_values.record_id as string,mealId=meal.actual_values.meal_id as string;
  const search=async()=> (await f.queries.lifeSearch(f.context,{q:"合成",types:["meals","money"]})).items;
  assert.ok((await search()).some(row=>row.id===mealId));
  const detail=await f.queries.lifeRecord(f.context,recordId);
  assert.ok(detail.kind==="record");assert.equal(detail.sources?.[0]?.original_text,"合成手动午餐");
  await f.pool.query("update meals set state='deleted' where id=$1",[mealId]);
  assert.ok(!(await search()).some(row=>row.id===mealId));
  assert.ok((await search()).some(row=>row.record_id===recordId));
  const removed=await f.queries.lifeRecord(f.context,recordId);
  assert.ok(removed.kind==="record");assert.deepEqual(removed.meals,[]);assert.deepEqual(removed.sources,[]);
  await assert.rejects(()=>f.run("life.link_meal_consumption",{meal_id:mealId,consumption_record_id:recordId,evidence:"user_confirmed"}),/active meal/);
  await f.pool.query("update meals set state='active' where id=$1",[mealId]);
  await f.pool.query("update consumption_records set state='voided',voided_at=now() where id=$1",[recordId]);
  await assert.rejects(()=>f.run("life.link_meal_consumption",{meal_id:mealId,consumption_record_id:recordId,evidence:"user_confirmed"}),/confirmed consumption/);
  assert.ok(!(await search()).some(row=>row.record_id===recordId));
  const reverse=await f.queries.lifeRecord(f.context,mealId);assert.ok(reverse.kind==="meal");assert.deepEqual(reverse.payments,[]);
});

test("direct meal links serialize competing claims and distinguish purchases from unrelated money",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const meal=async()=>String((await f.run("life.record_meal",mealInput)).actual_values.meal_id);
  const [first,second]=await Promise.all([meal(),meal()]);
  const entry=async(entry_type:string)=>String((await f.run("money.record_entry",{...date,entry_type,amount:"8.00",currency:"CNY"})).actual_values.record_id);
  const link=(meal_id:string,consumption_record_id:string)=>f.run("life.link_meal_consumption",{meal_id,consumption_record_id,evidence:"user_confirmed"});
  await assert.rejects(link(first,await entry("income")),/confirmed consumption/);
  const expense=await entry("expense");
  const race=await Promise.allSettled([link(first,expense),link(second,expense)]);
  assert.equal(race.filter(result=>result.status==="fulfilled").length,1);
  const winner=race[0]!.status==="fulfilled"?first:second;
  await link(winner,expense);
  const direct=await f.run("life.record_meal",{...mealInput,payment:{...date,amount:"8.00",currency:"CNY"}});
  await assert.rejects(link(first,String(direct.actual_values.record_id)),/同日同餐次/);
  const unpaid=await f.run("life.record_purchase",{...date,scene:"delivery",items:[{raw_name:"盒饭"}]});
  await link(first,String(unpaid.actual_values.record_id));
});
