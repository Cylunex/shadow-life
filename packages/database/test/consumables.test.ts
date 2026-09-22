import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";
import { recordPurchaseInputSchema } from "@shadow/contracts";

const purchaseInput={occurred_on:"2026-09-01",time_zone:"Asia/Shanghai",scene:"online_purchase",items:[{raw_name:"咖啡 80 袋"}],consumables:[{item_position:0,initial_quantity:"80",quantity_unit:"count",quantity_label:"袋",expected_daily_usage:"1"}],payment:{amount:"30.00",currency:"CNY",occurred_on:"2026-09-01",time_zone:"Asia/Shanghai"}};
const cycleInput={item_name:"咖啡 80 袋",state:"active",usage_state:"in_use",started_on:"2026-09-02",initial_quantity:"80",quantity_unit:"count",quantity_label:"袋",expected_daily_usage:"1"};

test("purchase atomically creates pending consumable; uses replay, correct and void without another payment",pgOnly,async t=>{
 const {run,queries,context,pool,executor,command}=await reviewFixture(t);
 const intent=command("life.record_purchase",purchaseInput),purchase=await executor.execute(context,intent);assert.equal((await executor.execute(context,intent)).replayed,true);
 const id=purchase.resources.find(r=>r.type==="use_cycle")!.id;
 const read=async()=>(await queries.moneyPlanning(context,"2026-09")).use_cycles.find(c=>c.id===id)!;
 let cycle=await read();assert.equal(cycle.usage_state,"pending");assert.equal(cycle.remaining_quantity,null);assert.equal(cycle.estimated_remaining_quantity,null);assert.equal(cycle.projected_depletion_on,null);assert.equal(cycle.purchase_record_id,purchase.actual_values.record_id);
 await assert.rejects(()=>run("money.record_consumable_use",{cycle_id:id,expected_revision:1,occurred_on:"2026-09-03",quantity:"1"}),/已启用/u);
 await run("money.set_use_cycle",{...cycleInput,cycle_id:id,expected_revision:1,purchase_record_id:cycle.purchase_record_id,purchase_item_id:cycle.purchase_item_id});
 const use=command("money.record_consumable_use",{cycle_id:id,expected_revision:2,occurred_on:"2026-09-03",quantity:"1"}),saved=await executor.execute(context,use);assert.equal((await executor.execute(context,use)).replayed,true);
 cycle=await read();assert.equal(cycle.consumed_quantity,"1");assert.equal(cycle.remaining_quantity,"79");assert.equal(cycle.uses!.length,1);assert.equal(cycle.quantity_label,"袋");
 await run("money.record_consumable_use",{cycle_id:id,expected_revision:3,use_id:saved.actual_values.use_id,occurred_on:"2026-09-03",quantity:"2",reason:"实际两袋"});assert.equal((await read()).remaining_quantity,"78");
 await run("money.record_consumable_use",{cycle_id:id,expected_revision:4,use_id:saved.actual_values.use_id,occurred_on:"2026-09-03",quantity:"2",state:"voided",reason:"记错批次"});assert.equal((await read()).remaining_quantity,"80");
 assert.equal((await pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
 assert.equal((await pool.query("select count(*)::int n from use_cycles")).rows[0].n,1);
 assert.equal((await pool.query("select count(*)::int n from consumable_use_revisions")).rows[0].n,2);
});

test("consumable versions, dates, dimensions and actual stock reject conflicting writes",pgOnly,async t=>{
 const {run,queries,context}=await reviewFixture(t);const created=await run("money.set_use_cycle",{...cycleInput,initial_quantity:"2"}),id=created.actual_values.use_cycle_id;
 for(const date of ["2026-09-01","2999-01-01"])await assert.rejects(()=>run("money.record_consumable_use",{cycle_id:id,expected_revision:1,occurred_on:date,quantity:"1"}),/日期|未来/u);
 const responses=await Promise.allSettled([1,2].map(()=>run("money.record_consumable_use",{cycle_id:id,expected_revision:1,occurred_on:"2026-09-03",quantity:"1"})));assert.equal(responses.filter(r=>r.status==="fulfilled").length,1);
 await assert.rejects(()=>run("money.record_consumable_use",{cycle_id:id,expected_revision:2,occurred_on:"2026-09-03",quantity:"2"}),/超过/u);
 for(const change of [{initial_quantity:"0.5"},{usage_state:"pending"},{quantity_unit:"g"},{match_mode:"exact_name",match_value:"咖啡"},{started_on:"2026-09-04"}])await assert.rejects(()=>run("money.set_use_cycle",{...cycleInput,initial_quantity:"2",cycle_id:id,expected_revision:2,...change}));
 const other={...context,subjectId:"subject_other_consumable",actorId:"subject_other_consumable"};await assert.rejects(()=>run("money.record_consumable_use",{cycle_id:id,expected_revision:2,occurred_on:"2026-09-03",quantity:"1"},other),/不存在/u);
 assert.equal((await queries.moneyPlanning(context,"2026-09")).use_cycles[0]!.remaining_quantity,"1");
});

test("purchase tracking needs planning permission; invalid item positions never write partial orders",pgOnly,async t=>{
 const {run,context,pool}=await reviewFixture(t);
 const limited={...context,effects:new Set(["life.purchase.write","money.entry.write"])};
 await assert.rejects(()=>run("life.record_purchase",purchaseInput,limited));
 assert.equal((await pool.query("select count(*)::int n from purchases")).rows[0].n,0);
 for(const consumables of [[{item_position:1}],[{item_position:0},{item_position:0}]])assert.equal(recordPurchaseInputSchema.safeParse({...purchaseInput,consumables}).success,false);
 const {consumables:_,...regular}=purchaseInput;await run("life.record_purchase",regular,limited);
 assert.equal((await pool.query("select count(*)::int n from use_cycles")).rows[0].n,0);
});

test("money titles and search use concrete purchase names only with purchase read permission",pgOnly,async t=>{
 const {run,queries,context}=await reviewFixture(t);const purchase=await run("life.record_purchase",purchaseInput),id=purchase.actual_values.money_entry_id;
 assert.equal((await queries.listDomain(context,"money")).items.find(i=>i.id===id)!.title,"咖啡 80 袋");
 assert.equal((await queries.lifeTimeline(context,{})).items.find(i=>i.id===id)!.title,"咖啡 80 袋");
 assert.equal((await queries.lifeSearch(context,{q:"咖啡",types:["money"]})).items.find(i=>i.id===id)!.title,"咖啡 80 袋");
 const limited={...context,effects:new Set(["money.entry.read"])};
 assert.equal((await queries.listDomain(limited,"money")).items.find(i=>i.id===id)!.title,"支出");
 assert.equal((await queries.lifeSearch(limited,{q:"咖啡",types:["money"]})).items.length,0);
 assert.equal((await queries.lifeTimeline(limited,{})).items.find(i=>i.id===id)!.title,"支出");
});
