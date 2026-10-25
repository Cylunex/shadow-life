import assert from "node:assert/strict";
import test from "node:test";
import {reviewFixture,pgOnly,mealInput} from "./review-fixture.js";

test("record detail follows explicit payment and consumption links in both directions with permission projection",pgOnly,async t=>{
  const {run,queries,context,pool,unitOfWork}=await reviewFixture(t);
  const meal=await run("life.record_meal",{...mealInput,payment:{amount:"20.00",currency:"CNY",occurred_on:mealInput.occurred_on,time_zone:mealInput.time_zone}});
  const mealId=String(meal.actual_values.meal_id);
  const entry=(await pool.query("select entry.* from money_entries entry join meal_money_links link on link.money_entry_id=entry.id where link.meal_id=$1",[mealId])).rows[0];
  assert.ok(entry);
  const detail=await queries.lifeRecord(context,entry.record_id);
  assert.equal(detail.kind,"record");if(detail.kind!=="record")throw new Error("expected record");
  assert.deepEqual(detail.meals?.map(item=>item.id),[mealId]);
  const refund=await run("money.record_refund",{original_entry_id:entry.id,amount:"2.00",currency:"CNY",occurred_on:"2026-09-11",time_zone:"Asia/Shanghai"});
  const refundId=refund.resources.find(resource=>resource.type==="money_entry")!.id;
  assert.equal((await queries.lifeRecord(context,refundId)).related_records?.[0]?.id,entry.record_id);
  assert.equal((await queries.lifeRecord(context,entry.record_id)).related_records?.[0]?.title,"关联退款");
  const moneyOnly=await queries.lifeRecord({...context,effects:new Set(["money.entry.read"])},entry.record_id);
  assert.equal("meals" in moneyOnly,false);
  const mealOnly=await queries.lifeRecord({...context,effects:new Set(["life.meal.read"])},entry.record_id);
  assert.deepEqual(mealOnly.related_records,[]);
  await unitOfWork.ensurePrincipal("subject_unrelated");
  await assert.rejects(()=>queries.lifeRecord({...context,subjectId:"subject_unrelated"},entry.record_id),/not found/);
});

test("linked purchase and trip fare navigation retain subject and current effect boundaries",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const dining=await run("life.record_dining",{occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",meal_type:"lunch",items:[{name:"米饭",estimate:false}],merchant_name_raw:"餐厅",payment:{amount:"30.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"}});
  const mealId=String(dining.actual_values.meal_id),recordId=String(dining.actual_values.consumption_record_id);
  assert.equal((await queries.lifeRecord(context,mealId)).related_records?.[0]?.id,recordId);
  const trip=await run("travel.create_trip",{title:"测试旅行",starts_on:"2026-09-10",ends_on:"2026-09-12",time_zone:"Asia/Shanghai"});
  const tripId=String(trip.actual_values.trip_id);
  await run("travel.add_reservation",{trip_id:tripId,reservation_type:"restaurant",title:"午餐预订",state:"confirmed",fare:{amount:"30.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"}});
  const entry=(await pool.query("select entry.record_id from money_entries entry join reservations reservation on reservation.fare_entry_id=entry.id where reservation.trip_id=$1",[tripId])).rows[0];
  const links=(await queries.lifeRecord(context,entry.record_id)).related_records;
  assert.equal(links?.find(link=>link.kind==="trip")?.id,tripId);
  const noTravel={...context,effects:new Set([...context.effects].filter(effect=>effect!=="travel.trip.read"))};
  assert.equal((await queries.lifeRecord(noTravel,entry.record_id)).related_records?.some(link=>link.kind==="trip"),false);
  const noMoney={...context,effects:new Set(["travel.trip.read"])};
  assert.equal("fare_entry_id" in (await queries.travelTrip(noMoney,tripId)).reservations[0]!,false);
});
