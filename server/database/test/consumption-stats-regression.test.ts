import assert from "node:assert/strict";
import test from "node:test";
import { pgOnly, reviewFixture } from "./review-fixture.js";

test("consumption statistics keep order, meal, item and refund facts deduplicated",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const purchase=await run("life.record_purchase",{scene:"delivery",merchant_name_raw:"示例饭店（人民广场店）",occurred_on:"2026-09-01",occurred_at:"2026-08-31T16:30:00Z",time_zone:"Asia/Shanghai",items:[{raw_name:"牛肉饭",quantity:"1",unit:"份",line_amount:"28.00"},{raw_name:"包装费",quantity:"1",unit:"份",line_amount:"2.00"}],payment:{amount:"30.00",currency:"CNY",occurred_on:"2026-09-01",time_zone:"Asia/Shanghai"}});
  const meal=await run("life.record_meal",{occurred_on:"2026-09-01",occurred_at:"2026-09-01T04:40:00Z",time_zone:"Asia/Shanghai",meal_type:"lunch",items:[{name:"牛肉饭",quantity:"1",unit:"份",consumed_fraction:"0.8",estimate:false}]});
  await run("life.link_meal_consumption",{meal_id:meal.actual_values.meal_id,consumption_record_id:purchase.actual_values.record_id,evidence:"user_confirmed"});
  await run("money.record_refund",{original_entry_id:purchase.actual_values.money_entry_id,amount:"5.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"});
  const input={from_on:"2026-09-01",to_on_exclusive:"2026-10-01",time_zone:"Asia/Shanghai",currency:"CNY",limit:20};
  const result=await queries.consumptionStats(context,input);
  assert.equal(result.coverage.orders,1);assert.equal(result.coverage.meal_linked_orders,1);assert.equal(result.coverage.excluded_service_lines,1);
  assert.deepEqual(result.monthly[0]?.spend,[{currency:"CNY",gross:"30",refund:"5",net:"25"}]);
  assert.equal(result.items.find(item=>item.canonical_name==="牛肉饭")?.purchased_orders,1);assert.equal(result.items.find(item=>item.canonical_name==="牛肉饭")?.confirmed_consumptions,1);assert.deepEqual(result.items.find(item=>item.canonical_name==="牛肉饭")?.quantities.map(row=>[row.basis,row.quantity]),[["consumed","0.8"],["purchased","1"]]);
  assert.equal(result.items.some(item=>item.canonical_name==="包装费"),false);
  const mealOnly=await queries.consumptionStats({...context,effects:new Set(["life.meal.read"])},input);
  assert.equal(mealOnly.coverage.money_authorized,false);assert.deepEqual(mealOnly.monthly[0]?.spend,[]);
  await assert.rejects(()=>queries.consumptionStats({...context,effects:new Set(["life.meal.read"])},{...input,merchant_rank_by:"net_spend"}),/money.entry.read/);
});
