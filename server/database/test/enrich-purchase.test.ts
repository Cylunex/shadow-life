import assert from "node:assert/strict";
import test from "node:test";
import {reviewFixture,pgOnly} from "./review-fixture.js";

const money={occurred_on:"2026-10-24",time_zone:"Asia/Shanghai",entry_type:"expense",amount:"26.00",currency:"CNY",counterparty:"合成商店",note:"原始支付说明"};
const library={title:"合成订单",item_type:"note",text:"合成面条2袋",tags:[],source:{kind:"text",captured_on:"2026-10-24",original_text:"合成订单原件"}};

test("enriching an expense reuses its payment and original Library sources, preserves meal links and replays once",pgOnly,async t=>{
  const f=await reviewFixture(t),payment=await f.run("money.record_entry",money),rid=String(payment.actual_values.record_id);
  const doc=await f.run("library.capture",library),lid=String(doc.actual_values.library_item_id);
  const meal=await f.run("life.record_meal",{occurred_on:"2026-10-25",time_zone:"Asia/Shanghai",meal_type:"lunch",items:[{name:"合成面条",estimate:false}]});
  await f.run("life.link_meal_consumption",{meal_id:meal.actual_values.meal_id,consumption_record_id:rid,evidence:"user_confirmed"});
  const before=await f.queries.lifeRecord(f.context,rid);if(before.kind!=="record")throw Error("record expected");
  const input={record_id:rid,expected_revision:before.revision,scene:"online_purchase",merchant_name_raw:"合成商店",items:[{raw_name:"合成面条",quantity:"2",unit:"袋"}],library_items:[{id:lid,revision:1}],reason:"用户确认是这单，关联原件和商品"};
  const command=f.command("life.enrich_purchase",input),saved=await f.executor.execute(f.context,command),replayed=await f.executor.execute(f.context,command);
  assert.equal(saved.actual_values.payment_unchanged,true);assert.equal(replayed.replayed,true);
  const after=await f.queries.lifeRecord(f.context,rid);if(after.kind!=="record")throw Error("record expected");
  assert.equal(after.record_id,rid);assert.deepEqual(after.money_entry,before.money_entry);assert.deepEqual(after.meals,before.meals);
  assert.equal(after.purchase?.scene,"online_purchase");assert.equal(after.purchase_items?.length,1);assert.equal(after.purchase_items?.[0]?.raw_name,"合成面条");
  const source=(await f.pool.query("select source_id from library_items where id=$1",[lid])).rows[0].source_id;
  assert.ok(after.sources?.some(s=>s.id===source));assert.equal((await f.pool.query("select count(*) count from money_entries")).rows[0].count,"1");
  await assert.rejects(()=>f.run("life.enrich_purchase",{...input,expected_revision:after.revision}),/already exists/);
  assert.equal((await f.pool.query("select count(*) count from purchase_items")).rows[0].count,"1");
});

test("foreign owner, stale Library revision, missing source and missing effects cannot attach evidence or change an expense",pgOnly,async t=>{
  const f=await reviewFixture(t),payment=await f.run("money.record_entry",money),rid=String(payment.actual_values.record_id);
  const doc=await f.run("library.capture",library),lid=String(doc.actual_values.library_item_id);
  const bare=await f.run("library.capture",{title:"没有原件",item_type:"note",text:"仅文字",tags:[]});
  await f.unitOfWork.ensurePrincipal("subject_other_enrich");
  const other=await f.run("library.capture",library,{...f.context,subjectId:"subject_other_enrich",actorId:"subject_other_enrich"});
  const base={record_id:rid,expected_revision:1,scene:"online_purchase",items:[{raw_name:"合成面条"}],reason:"补齐原件"};
  for(const ref of [{id:lid,revision:2},{id:bare.actual_values.library_item_id,revision:1},{id:other.actual_values.library_item_id,revision:1}]){
    await assert.rejects(()=>f.run("life.enrich_purchase",{...base,library_items:[ref]}),/unavailable/);
  }
  await assert.rejects(()=>f.run("life.enrich_purchase",{...base,expected_revision:9,library_items:[{id:lid,revision:1}]}),/current confirmed/);
  await assert.rejects(()=>f.run("life.enrich_purchase",{...base,library_items:[{id:lid,revision:1}]},{...f.context,effects:new Set(["life.purchase.write","money.entry.read","library.item.read"])}),/effect|permission|denied/i);
  const unchanged=await f.queries.lifeRecord(f.context,rid);if(unchanged.kind!=="record")throw Error("record expected");
  assert.equal(unchanged.revision,1);assert.equal(unchanged.purchase,null);assert.equal((await f.pool.query("select count(*) count from consumption_record_revisions")).rows[0].count,"0");
});

test("concurrent enrichment intents serialize on the existing expense revision",pgOnly,async t=>{
  const f=await reviewFixture(t),payment=await f.run("money.record_entry",money),rid=String(payment.actual_values.record_id);
  const doc=await f.run("library.capture",library),lid=String(doc.actual_values.library_item_id);
  const input={record_id:rid,expected_revision:1,scene:"online_purchase",items:[{raw_name:"合成面条"}],library_items:[{id:lid,revision:1}],reason:"补齐原订单"};
  const results=await Promise.allSettled([f.run("life.enrich_purchase",input),f.run("life.enrich_purchase",input)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await f.pool.query("select count(*) count from purchases")).rows[0].count,"1");
  assert.equal((await f.pool.query("select count(*) count from money_entries")).rows[0].count,"1");
  const {enrichPurchaseInputSchema}=await import("@shadow/contracts");
  assert.equal(enrichPurchaseInputSchema.safeParse({...input,payment:{amount:"26.00"}}).success,false);
  assert.equal(enrichPurchaseInputSchema.safeParse({...input,library_items:[input.library_items[0],input.library_items[0]]}).success,false);
});
