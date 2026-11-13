import assert from "node:assert/strict";
import test from "node:test";
import {pgOnly,reviewFixture} from "./review-fixture.js";

test("explicit branch and preparation preferences survive replays and clear without changing the purchase",pgOnly,async t=>{
  const {run,queries,context,pool,executor,command,unitOfWork}=await reviewFixture(t);
  const order=await run("life.record_purchase",{occurred_on:"2026-11-13",time_zone:"Asia/Shanghai",scene:"delivery",
    merchant_name_raw:"小馆",items:[{raw_name:"蒸鱼"},{raw_name:"面"},{raw_name:"蛋糕"}]});
  const {rows:[line]}=await pool.query("select id from purchase_items where purchase_id=$1 and position=(select min(position) from purchase_items where purchase_id=$1)",[order.actual_values.purchase_id]);
  const input={shop_source:"外卖",shop_name:"小馆·西街",dish_name:"蒸鱼",preference:"repeat",purchase_item_id:line.id,note:"微辣"};
  const cmd=command("life.save_dish_preference",input);
  await executor.execute(context,cmd);assert.equal((await executor.execute(context,cmd)).replayed,true);
  await assert.rejects(()=>run("life.save_dish_preference",input),/已更新/u);
  await run("life.save_dish_preference",{...input,shop_name:"小馆·东街",purchase_item_id:undefined,preference:"try"});
  await run("life.save_dish_preference",{...input,dish_name:"红烧鱼",purchase_item_id:undefined,preference:"try"});
  const first=await queries.dishPreferences(context,{shop_name:input.shop_name,limit:1});
  assert.ok(first.next);const second=await queries.dishPreferences(context,{shop_name:input.shop_name,limit:1,...first.next});
  assert.deepEqual([first.items[0]?.dish_name,second.items[0]?.dish_name],["红烧鱼","蒸鱼"]);
  const other={...context,subjectId:"subject_other_dish"};await unitOfWork.ensurePrincipal(other.subjectId);
  assert.equal((await queries.dishPreferences(other,{})).items.length,0);
  await assert.rejects(()=>run("life.save_dish_preference",input,other),/本人已确认/);
  await assert.rejects(()=>queries.dishPreferences({...context,effects:new Set()},{}));
  await run("life.save_dish_preference",{...input,preference:"cleared",expected_revision:1});
  assert.equal((await queries.dishPreferences(context,{})).items.length,2);
  await run("life.save_dish_preference",{...input,preference:"avoid"});
  const {rows:[purchase]}=await pool.query("select rating,revision from purchases where id=$1",[order.actual_values.purchase_id]);
  assert.deepEqual(purchase,{rating:null,revision:1});assert.equal((await pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
});
