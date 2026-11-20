import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("daily domains retain evidence, explicit stock, location and one-day timing",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const plan=await run("health.set_plan",{kind:"workout",name:"慢跑",state:"active",schedule:{days:[1,3]}});
  const planId=plan.actual_values.health_plan_id as string;
  assert.equal((await queries.workoutProgression(context,{plan_id:planId})).plans[0]?.status,"no_execution");
  await run("health.record_workout",{plan_id:planId,occurred_on:"2026-09-20",time_zone:"Asia/Shanghai",session_type:"run",duration_minutes:30,rpe:6});
  assert.equal((await queries.workoutProgression(context,{plan_id:planId})).plans[0]?.status,"missing_data");
  await run("health.record_workout",{plan_id:planId,occurred_on:"2026-09-22",time_zone:"Asia/Shanghai",session_type:"run",duration_minutes:32,rpe:6});
  const suggestion=(await queries.workoutProgression(context,{plan_id:planId})).plans[0]!;
  assert.equal(suggestion.status,"increase_duration");assert.equal(suggestion.next_duration_minutes,34);assert.equal(suggestion.evidence.length,2);
  await assert.rejects(()=>queries.workoutProgression({...context,effects:new Set()},{}),/permission/i);

  const recipe=await run("life.save_recipe",{title:"米饭",servings:"2",items:[{name:"米",quantity:"2",unit:"碗",estimate:false}],source_url:"https://example.com/rice",state:"active"});
  const catalog=await queries.foodCatalog(context,{limit:50});
  assert.equal(catalog.recipes.find(item=>item.id===recipe.actual_values.recipe_id)?.source_url,"https://example.com/rice");
  const mealPlan=await run("life.save_meal_plan",{title:"一日餐单",starts_on:"2026-09-24",ends_on:"2026-09-24",time_zone:"Asia/Shanghai",entries:[{plan_date:"2026-09-24",meal_type:"dinner",title:"米饭",servings:"2",recipe_id:recipe.actual_values.recipe_id,recipe_revision:1}]});
  const list=await run("life.build_shopping_list",{meal_plan_id:mealPlan.actual_values.meal_plan_id,expected_meal_plan_revision:1,title:"采购"});
  assert.equal((await queries.mealPlanning(context,{limit:20})).stock_lots.length,0);
  await run("life.update_shopping_item",{shopping_item_id:list.resources.find(item=>item.type==="shopping_list_item")!.id,expected_revision:1,state:"bought"});
  assert.equal((await queries.mealPlanning(context,{limit:20})).stock_lots.length,0,"buying does not create stock");
  const stock=await run("life.set_food_stock",{name:"米",quantity:"1",unit:"碗",expires_on:"2026-10-01"});
  assert.equal((await queries.mealPlanning(context,{limit:20})).stock_lots[0]?.quantity,"1");
  await run("life.set_food_stock",{lot_id:stock.actual_values.lot_id,expected_revision:1,name:"米",quantity:"2",unit:"碗"});
  assert.equal((await pool.query("select count(*)::int n from food_stock_lot_revisions where lot_id=$1",[stock.actual_values.lot_id])).rows[0].n,1);
  await assert.rejects(()=>run("life.set_food_stock",{lot_id:stock.actual_values.lot_id,expected_revision:1,name:"米",quantity:"3",unit:"碗"}),/revision changed/);

  const item=await run("life.save_owned_item",{name:"耳机",ownership_state:"owned",location_path:["书房","抽屉"],documents:[]});
  assert.deepEqual((await queries.ownedItems(context,{id:item.actual_values.owned_item_id,limit:1})).items[0]?.location_path,["书房","抽屉"]);
  assert.equal((await queries.ownedItems({...context,subjectId:"another_subject"},{id:item.actual_values.owned_item_id,limit:1})).items.length,0);
  const project=await run("life.save_project",{title:"整理",goal:"整理书房",state:"active",milestones:[],links:[]});
  const action=await run("life.save_action_item",{project_id:project.actual_values.project_id,title:"整理抽屉",due_on:"2026-09-24",scheduled_at:"2026-09-24T11:00:00.000Z",scheduled_time_zone:"Asia/Shanghai",state:"open"});
  const read=(await queries.lifeProjects(context,{id:project.actual_values.project_id,limit:1})).items[0]!.actions[0]!;
  assert.match(read.scheduled_at!,/^2026-09-24T11:00:00/);
  await run("life.save_action_item",{action_item_id:action.actual_values.action_item_id,expected_revision:1,project_id:project.actual_values.project_id,title:"整理抽屉",due_on:"2026-09-24",state:"completed"});
  const preserved=(await pool.query("select scheduled_at::text from action_items where id=$1",[action.actual_values.action_item_id])).rows[0];
  assert.ok(preserved.scheduled_at,"status updates preserve a previously scheduled time");
  await assert.rejects(()=>run("life.save_action_item",{project_id:project.actual_values.project_id,title:"跨日",due_on:"2026-09-24",scheduled_at:"2026-09-25T11:00:00.000Z",scheduled_time_zone:"Asia/Shanghai"}),/scheduled time/i);
});

test("purchase destinations reuse an existing link and stock retains its authorized purchase source",pgOnly,async t=>{
  const {run,queries,context,unitOfWork}=await reviewFixture(t);
  const on="2026-11-20";
  const purchase=await run("life.record_purchase",{occurred_on:on,time_zone:"Asia/Shanghai",scene:"offline_purchase",
    items:[{raw_name:"米",quantity:"1",unit:"袋"}]});
  const itemId=purchase.resources.find(item=>item.type==="purchase_item")!.id;
  const recordId=purchase.actual_values.record_id;
  const source={purchase_item_id:itemId};
  const [stock,again]=await Promise.all([
    run("life.set_food_stock",{...source,name:"米",quantity:"1",unit:"袋"}),
    run("life.set_food_stock",{...source,name:"米",quantity:"1",unit:"袋"})
  ]);
  assert.equal(again.actual_values.lot_id,stock.actual_values.lot_id);
  const owner={...source,name:"米",started_on:on,reuse_purchase_link:true};
  assert.equal((await run("life.save_owned_item",owner)).actual_values.owned_item_id,
    (await run("life.save_owned_item",owner)).actual_values.owned_item_id);
  const cycle={...source,purchase_record_id:recordId,item_name:"米",started_on:on,state:"active",usage_state:"pending",
    quantity_unit:"count",initial_quantity:"1",reuse_purchase_link:true};
  assert.equal((await run("money.set_use_cycle",cycle)).actual_values.use_cycle_id,
    (await run("money.set_use_cycle",cycle)).actual_values.use_cycle_id);
  await run("life.set_food_stock",{lot_id:stock.actual_values.lot_id,expected_revision:1,name:"米",quantity:"0",unit:"袋"});
  const lots=(await queries.mealPlanning(context,{limit:20})).stock_lots;
  assert.equal(lots.length,1);
  assert.equal(lots[0]?.quantity,"0");
  assert.equal(lots[0]?.purchase_record_id,recordId);
  const other={...context,actorId:"subject_other_purchase",subjectId:"subject_other_purchase"};
  await unitOfWork.ensurePrincipal(other.subjectId);
  await assert.rejects(()=>run("life.set_food_stock",{...source,name:"米",quantity:"1",unit:"袋"},other),/purchase item does not exist/);
});
