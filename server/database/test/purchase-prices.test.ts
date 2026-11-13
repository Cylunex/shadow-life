import test from "node:test";
import assert from "node:assert/strict";
import {reviewFixture,pgOnly} from "./review-fixture.js";
test("price coverage counts comparable same-product purchases and keeps volume, mass and money basis explicit",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  for(let day=1;day<=3;day++){
    await run("life.record_purchase",{occurred_on:`2026-11-0${day}`,time_zone:"Asia/Shanghai",scene:"offline_purchase",merchant_name_raw:"合成食品店",
      items:[{raw_name:"全脂奶",quantity:"500",unit:"ml",line_amount:"6.00"},{raw_name:"细面粉",quantity:"1",unit:"kg",line_amount:"8.00"}]});
  }
  const x=await run("life.record_purchase",{occurred_on:"2026-11-07",time_zone:"Asia/Shanghai",scene:"offline_purchase",items:[{raw_name:"双瓶牛奶",quantity:"1",unit:"组",line_amount:"12.00"}]});
  let result=await queries.purchasePrices(context,{});assert.deepEqual(result.coverage,{total:7,identified:7,convertible:6,comparable:6,qualified:2});
  const item=result.items.find(r=>r.record_id===x.actual_values.record_id)!;assert.equal(item.unit_price,null);
  const input={purchase_item_id:item.id,product:"全脂奶",pack_count:"2",pack_size:"500",unit:"ml",price_basis:"listed",discount:"2.00"};
  await run("life.set_price_spec",input);
  result=await queries.purchasePrices(context,{product:"全脂奶",limit:2});assert.deepEqual(result.items.map(r=>Number(r.unit_price)),[10,12]);assert.equal(result.items[0]?.base_unit,"L");
  assert.ok(result.next);assert.equal((await queries.purchasePrices(context,{product:"全脂奶",...result.next})).items.length,2);
  await assert.rejects(()=>run("life.set_price_spec",{...input,expected_revision:1,discount:"15.00"}));
  await assert.rejects(()=>queries.purchasePrices({...context,effects:new Set(["life.meal.read"])},{}));
  assert.equal((await queries.purchasePrices({...context,subjectId:"subject_other_price"},{})).coverage.total,0);
});
