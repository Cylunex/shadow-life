import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("planning attention shares authoritative dates, owner scope and truthful limited coverage",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const stock=await run("life.set_food_stock",{name:"合成食品",quantity:"0.000001",unit:"份",expires_on:"2026-10-22"});
  const planning=await queries.mealPlanning(context,{on:"2026-10-21",time_zone:"America/New_York"});
  assert.equal(planning.stock_attention?.on,"2026-10-21");assert.equal(planning.stock_attention?.time_zone,"America/New_York");
  assert.deepEqual(planning.stock_attention?.items,[{lot_id:stock.actual_values.lot_id,state:"soon",days_until:1}]);
  const owned=await run("life.save_owned_item",{name:"合成耳机",return_by:"2026-10-22",warranty_ends_on:"2026-11-21",ownership_state:"owned",documents:[]});
  await run("life.save_owned_item",{name:"合成旧耳机",return_by:"2026-10-22",ownership_state:"returned",documents:[]});
  const limited=await queries.ownedItems(context,{limit:1,on:"2026-10-22"});
  assert.equal(limited.truncated,true);assert.equal(limited.items.length,1);assert.equal(limited.attention?.items.length,1);assert.equal(limited.attention?.items[0]?.item_id,limited.items[0]?.id);
  const exact=await queries.ownedItems(context,{id:owned.actual_values.owned_item_id,limit:1,on:"2026-10-22"});
  assert.equal(exact.truncated,false);assert.equal(exact.attention?.items[0]?.return_window.state,"today");assert.equal(exact.attention?.items[0]?.warranty.days_until,30);
  const full=await queries.ownedItems(context,{limit:2,on:"2026-10-22"});assert.equal(full.truncated,false);
  assert.equal(full.attention?.items.find(item=>item.item_id!==owned.actual_values.owned_item_id)?.return_window.state,"inactive");
  const foreign=await queries.ownedItems({...context,subjectId:"subject_other"},{limit:1,on:"2026-10-22"});assert.equal(foreign.items.length,0);assert.equal(foreign.attention?.items.length,0);assert.equal(foreign.truncated,false);
  await assert.rejects(()=>queries.mealPlanning({...context,effects:new Set()},{}),/permission/i);
  await assert.rejects(()=>queries.ownedItems({...context,effects:new Set()},{}),/permission/i);
  assert.equal((await pool.query("select count(*)::int n from operations")).rows[0].n,3,"deadline queries must not write events");
});
