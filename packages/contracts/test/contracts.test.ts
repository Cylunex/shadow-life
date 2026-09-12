import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry, commandEnvelopeSchema, healthSourcesResultSchema, lifeTimelineInputSchema, lifeTodayInputSchema, lifeTodayResultSchema, moneyPlanningInputSchema, projectDirectoryResultSchema, publishTripPlanInputSchema, recordDiningInputSchema, recordMealInputSchema, setHealthPlanInputSchema, setHealthSourceStateInputSchema, setRecurringPlanInputSchema, setTripDayPlanInputSchema, setTripStopOutcomeInputSchema, universalCommandEnvelopeSchema } from "../src/index.js";

const meal = {
  occurred_on: "2026-09-08",
  time_zone: "Asia/Shanghai",
  meal_type: "lunch",
  items: [{ name: "牛肉面", quantity: "1", unit: "碗", estimate: false }],
  payment: { amount: "35.00", currency: "CNY", occurred_on: "2026-09-08", time_zone: "Asia/Shanghai" }
} as const;

test("record meal accepts canonical facts and resolves payment effect", () => {
  assert.deepEqual(recordMealInputSchema.parse(meal), meal);
  assert.deepEqual(capabilityRegistry["life.record_meal"].resolveEffects(meal), ["life.meal.write", "money.entry.write"]);
});

test("unknown fields and non-canonical money fail closed", () => {
  assert.equal(recordMealInputSchema.safeParse({ ...meal, payment: { amount: "35.0", currency: "CNY" } }).success, false);
  assert.equal(recordMealInputSchema.safeParse({ ...meal, payment: { amount: "35.00", currency: "USD" } }).success, false);
  assert.equal(commandEnvelopeSchema.safeParse({ protocol: "shadow.command", capability: "life.record_meal", command_id: "cmd_12345678", input: { ...meal, approved: true } }).success, false);
});

test("meal instant must agree with its local date", () => {
  assert.equal(recordMealInputSchema.safeParse({ ...meal, occurred_at: "2026-09-07T12:00:00Z" }).success, false);
  assert.equal(recordMealInputSchema.safeParse({ ...meal, time_zone: "Not/AZone" }).success, false);
});

test("an estimate must preserve its evidence", () => {
  assert.equal(recordMealInputSchema.safeParse({ ...meal, items: [{ name: "牛肉面", energy_kcal: "600", estimate: true }] }).success, false);
});

test("food and recipe catalog changes preserve explicit facts and revisions",()=>{const food=capabilityRegistry["life.save_food"].inputSchema;assert.equal(food.safeParse({name:"燕麦",serving_amount:"40",nutrients:{},state:"active"}).success,false);assert.equal(food.safeParse({name:"燕麦",nutrients:{},state:"active"}).success,true);assert.equal(food.safeParse({food_id:"food_12345678",expected_revision:1,name:"燕麦",nutrients:{},state:"active"}).success,false);const recipe=capabilityRegistry["life.save_recipe"].inputSchema;assert.equal(recipe.safeParse({recipe_id:"recipe_12345678",expected_revision:1,title:"早餐",servings:"1",items:[{name:"燕麦",quantity:"40",unit:"g",estimate:false}],state:"active",reason:"调整份量"}).success,true);assert.equal(recipe.safeParse({recipe_id:"recipe_12345678",expected_revision:1,title:"早餐",servings:"1",items:[{name:"燕麦",quantity:"40",unit:"g",estimate:false}],state:"active"}).success,false);const mealFromRecipe=capabilityRegistry["life.record_meal_from_recipe"].inputSchema;assert.equal(mealFromRecipe.safeParse({recipe_id:"recipe_12345678",expected_recipe_revision:1,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",meal_type:"breakfast",consumed_fraction:"0.5"}).success,true);assert.equal(mealFromRecipe.safeParse({recipe_id:"recipe_12345678",expected_recipe_revision:1,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",meal_type:"breakfast",consumed_fraction:"0"}).success,false);});

test("meal keeps payment date independent from eating date",()=>{
  const input={...meal,payment:{amount:"35.00",currency:"CNY",occurred_on:"2026-09-07",time_zone:"Asia/Shanghai"}} as const;
  assert.equal(recordMealInputSchema.safeParse(input).success,true);
  assert.equal(universalCommandEnvelopeSchema.safeParse({protocol:"shadow.command",capability:"life.record_meal",command_id:"cmd_12345678",input}).success,true);
  assert.equal(commandEnvelopeSchema.safeParse({protocol:"shadow.command",capability:"life.record_meal",command_id:"cmd_12345678",input}).success,true);
});

test("health plan states stay compatible with their model",()=>{
  assert.equal(setHealthPlanInputSchema.safeParse({kind:"goal",name:"体重目标",state:"paused",metric_key:"weight",target_value:"65",unit:"kg"}).success,false);
  assert.equal(setHealthPlanInputSchema.safeParse({kind:"habit",name:"每日拉伸",state:"achieved",schedule:{days:[1]}}).success,false);
  assert.equal(setHealthPlanInputSchema.safeParse({kind:"workout",name:"跑步",state:"active",schedule:{days:[2,4]}}).success,true);
});

test("health corrections are versioned and cannot target an unspecified fact",()=>{const schema=capabilityRegistry["health.correct_measurement"].inputSchema;assert.equal(schema.safeParse({measurement_id:"health_12345678",expected_revision:1,metric:"weight",value:"68.8",unit:"kg",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",reason:"秤面读数核对"}).success,true);assert.equal(schema.safeParse({measurement_id:"health_12345678",metric:"weight",value:"68.8",unit:"kg",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",reason:"缺少版本"}).success,false);});

test("today attention remains bounded and defaults safely for older read rows",()=>{
  const parsed=lifeTodayResultSchema.parse({date:"2026-09-10",domains:{money:{entries:0,totals:[],freshness:null},health:{facts:0,freshness:null},travel:{visits:0,freshness:null}},as_of:"2026-09-10T00:00:00Z"});
  assert.deepEqual(parsed.domains.money?.due_items,[]);assert.deepEqual(parsed.domains.health?.sync_issues,[]);assert.deepEqual(parsed.domains.travel?.current_trips,[]);
  const tooMany=Array.from({length:21},(_,index)=>({id:`plan_${String(index).padStart(8,"0")}`,due_on:"2026-09-10",state:"pending",title:"事项",amount:null,currency:null}));assert.equal(lifeTodayResultSchema.safeParse({date:"2026-09-10",domains:{money:{entries:0,totals:[],due_items:tooMany,freshness:null}},as_of:"2026-09-10T00:00:00Z"}).success,false);
});

test("money import is staged separately from candidate accounting decisions",()=>{assert.deepEqual(capabilityRegistry["money.stage_import"].resolveEffects(),["money.entry.write"]);assert.equal(capabilityRegistry["money.resolve_import_candidate"].inputSchema.safeParse({candidate_id:"import_candidate_12345678",expected_revision:1,decision:"ignore",corrections:{amount:"1.00"},reason:"忽略重复交易"}).success,false);assert.equal(capabilityRegistry["money.resolve_import_candidate"].inputSchema.safeParse({candidate_id:"import_candidate_12345678",expected_revision:1,decision:"confirm",corrections:{entry_type:"expense",amount:"18.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"},reason:"核对原始账单"}).success,true);assert.equal(capabilityRegistry["money.set_import_rule"].inputSchema.safeParse({match_value:"退款平台",replacements:{entry_type:"refund"},state:"active"}).success,false);assert.equal(capabilityRegistry["money.set_import_rule"].inputSchema.safeParse({match_value:"社区超市",replacements:{category:"日用"},state:"active"}).success,true);});

test("dining keeps purchased goods, consumed nutrition and source roles distinct",()=>{
  const base={occurred_on:"2026-09-09",time_zone:"Asia/Shanghai",meal_type:"lunch",consumed_items:[{name:"牛肉丸",consumed_fraction:"0.5",estimate:false}],purchased_items:[{raw_name:"牛肉丸套餐",quantity:"1",line_amount:"18.00"}],sources:[{kind:"image",role:"order_screenshot",captured_on:"2026-09-09",asset_version_id:"asset_version_12345678"}]} as const;
  assert.equal(recordDiningInputSchema.safeParse(base).success,true);
  assert.equal(recordDiningInputSchema.safeParse({...base,items:base.consumed_items}).success,false);
  assert.equal(recordDiningInputSchema.safeParse({...base,sources:[{kind:"image",captured_on:"2026-09-09",asset_version_id:"asset_version_12345678"}]}).success,false);
});

test("source-bearing capabilities require the source-link effect",()=>{
  const source={kind:"image",captured_on:"2026-09-09",asset_version_id:"asset_version_12345678"};
  assert.deepEqual(capabilityRegistry["library.capture"].resolveEffects({title:"票据",item_type:"image",tags:[],source}),["library.item.write","library.source.link"]);
  assert.deepEqual(capabilityRegistry["travel.record_visit"].resolveEffects({place_name:"西湖",occurred_on:"2026-09-09",time_zone:"Asia/Shanghai",source}),["travel.visit.write","library.source.link"]);
});

test("library processing and legacy proof inputs fail closed",()=>{
  assert.equal(capabilityRegistry["library.queue_processing"].inputSchema.safeParse({item_id:"library_12345678",source_asset_version_id:"assetv_12345678",kind:"text_extract",requested_processor:"builtin-text-v1"}).success,true);
  assert.equal(capabilityRegistry["library.complete_processing"].inputSchema.safeParse({job_id:"library_job_12345678",derived_asset_version_id:"assetv_12345678",processor_version:"v1",snippets:[]}).success,false);
  assert.equal(capabilityRegistry["library.set_reading_state"].inputSchema.safeParse({item_id:"library_12345678",item_revision:1,locator:{page:3},progress:.5,state:"completed"}).success,false);
  assert.equal("library.register_legacy_link" in capabilityRegistry,false);
});

test("agent context and durable memory keep permission and inference boundaries",()=>{
  const refs=[{kind:"meal" as const,id:"meal_12345678",revision:1},{kind:"library_item" as const,id:"library_12345678",revision:2}];
  assert.deepEqual(capabilityRegistry["agent.create_context_pack"].resolveEffects({object_refs:refs,ttl_minutes:15}),["agent.run","library.item.read","life.meal.read"]);
  assert.equal(capabilityRegistry["agent.create_context_pack"].inputSchema.safeParse({object_refs:[refs[0],refs[0]],ttl_minutes:15}).success,false);
  assert.equal(capabilityRegistry["agent.set_memory"].inputSchema.safeParse({category:"model_inference",memory_key:"guess",value:true,evidence_refs:[],state:"active"}).success,false);
  assert.equal(capabilityRegistry["agent.set_memory"].inputSchema.safeParse({category:"deterministic_aggregate",memory_key:"count",value:{count:2},evidence_refs:refs,algorithm_version:"count-v1",state:"active"}).success,true);
  assert.equal(capabilityRegistry["notifications.update"].inputSchema.safeParse({notification_id:"notification_12345678",action:"snooze"}).success,false);
});

test("owned items stay explicit and life reviews are bounded deterministic inputs",()=>{
  const save=capabilityRegistry["life.save_owned_item"],linked={purchase_item_id:"purchase_item_12345678",name:"耳机",ownership_state:"owned",documents:[{library_item_id:"library_12345678",library_revision:2,role:"receipt"}]} as const;
  assert.equal(save.inputSchema.safeParse(linked).success,true);assert.deepEqual(save.resolveEffects(linked),["life.item.write","life.meal.read","library.item.read"]);
  assert.equal(save.inputSchema.safeParse({...linked,owned_item_id:"owned_item_12345678",expected_revision:1}).success,false);
  assert.equal(capabilityRegistry["life.record_owned_item_event"].inputSchema.safeParse({owned_item_id:"owned_item_12345678",expected_revision:1,event_kind:"repair",occurred_on:"2026-09-10",note:"更换电池"}).success,true);
  const review={from_on:"2026-09-01",to_on:"2026-09-07",time_zone:"Asia/Shanghai",domains:["money","items"]} as const;
  assert.equal(capabilityRegistry["life.generate_review"].inputSchema.safeParse(review).success,true);assert.deepEqual(capabilityRegistry["life.generate_review"].resolveEffects(review),["life.review.write","money.entry.read","life.item.read"]);
  assert.equal(capabilityRegistry["life.generate_review"].inputSchema.safeParse({...review,to_on:"2027-09-10"}).success,false);
  assert.equal(capabilityRegistry["life.generate_review"].inputSchema.safeParse({...review,domains:["money","money"]}).success,false);
});

test("D2 contracts keep projects, meal plans and foreign money as separate facts",()=>{
  const project={title:"四周训练",goal:"完成四周训练周期",state:"active",milestones:[{title:"第一周",state:"planned"}],links:[{kind:"health_plan",id:"health_plan_12345678",revision:1,role:"target"}]} as const;assert.equal(capabilityRegistry["life.save_project"].inputSchema.safeParse(project).success,true);assert.deepEqual(capabilityRegistry["life.save_project"].resolveEffects(project),["life.project.write","health.measurement.read"]);
  assert.deepEqual(capabilityRegistry["life.save_action_item"].resolveEffects({project_id:"life_project_12345678",title:"缴费",recurring_occurrence_id:"recurring_occurrence_12345678"}),["life.project.write","money.entry.read"]);
  const plan={title:"周末餐单",starts_on:"2026-09-12",ends_on:"2026-09-13",time_zone:"Asia/Shanghai",state:"active",entries:[{plan_date:"2026-09-12",meal_type:"dinner",title:"燕麦",servings:"2",recipe_id:"recipe_12345678",recipe_revision:2}]} as const;assert.equal(capabilityRegistry["life.save_meal_plan"].inputSchema.safeParse(plan).success,true);assert.deepEqual(capabilityRegistry["life.save_meal_plan"].resolveEffects(plan),["life.meal_plan.write","life.meal.read"]);assert.deepEqual(capabilityRegistry["life.save_meal_plan"].resolveEffects({...plan,entries:[{plan_date:"2026-09-12",meal_type:"dinner",title:"自由安排",servings:"1"}]}),["life.meal_plan.write"]);assert.equal(capabilityRegistry["life.save_meal_plan"].inputSchema.safeParse({...plan,entries:[{...plan.entries[0],plan_date:"2026-09-14"}]}).success,false);assert.equal(capabilityRegistry["life.update_shopping_item"].inputSchema.safeParse({shopping_item_id:"shopping_item_12345678",expected_revision:1,state:"skipped",purchase_item_id:"purchase_item_12345678"}).success,false);
  const foreign={entry_type:"expense",amount:"100.00",currency:"JPY",source_scale:2,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",trip_id:"trip_12345678",conversion:{base_amount:"4.80",base_currency:"CNY",rate:"0.048",quoted_at:"2026-09-10T00:00:00Z",source_kind:"manual"},allocations:[{participant_label:"同伴",original_amount:"50.00",state:"unsettled"}]} as const;assert.equal(capabilityRegistry["money.record_foreign_entry"].inputSchema.safeParse(foreign).success,true);assert.deepEqual(capabilityRegistry["money.record_foreign_entry"].resolveEffects(foreign),["money.entry.write","travel.trip.read"]);assert.equal(capabilityRegistry["money.record_foreign_entry"].inputSchema.safeParse({...foreign,currency:"CNY"}).success,false);assert.equal(capabilityRegistry["money.record_foreign_entry"].inputSchema.safeParse({...foreign,amount:"100.123",source_scale:2}).success,false);assert.equal(capabilityRegistry["money.record_foreign_entry"].inputSchema.safeParse({...foreign,entry_type:"income"}).success,false);
  const settle=capabilityRegistry["money.update_shared_allocation"].inputSchema;assert.equal(settle.safeParse({allocation_id:"shared_expense_12345678",expected_revision:1,state:"settled",settled_on:"2026-09-10"}).success,true);assert.equal(settle.safeParse({allocation_id:"shared_expense_12345678",expected_revision:1,state:"settled"}).success,false);assert.equal(settle.safeParse({allocation_id:"shared_expense_12345678",expected_revision:1,state:"waived",settled_on:"2026-09-10"}).success,false);
});

test("life detail sections resolve the exact read effects",()=>{
  assert.deepEqual(capabilityRegistry["life.get_record"].resolveEffects({id:"record_12345678",sections:["meal","sources"]}),["life.meal.read"]);
  assert.deepEqual(capabilityRegistry["life.get_record"].resolveEffects({id:"record_12345678",sections:["money"]}),["money.entry.read"]);
  assert.deepEqual(capabilityRegistry["life.get_record"].resolveEffects({id:"record_12345678",sections:["purchase","money"]}),["life.meal.read","money.entry.read"]);
});

test("recurring plans preserve an explicit local schedule and supported RRULE",()=>{
  const value={title:"月末复盘",amount:"20.00",currency:"CNY",cadence:"monthly",next_due_on:"2026-01-31",anchor_on:"2026-01-31",local_time:"09:30",time_zone:"Asia/Shanghai",missing_date_policy:"last_day",recurrence_rule:"FREQ=MONTHLY;BYMONTHDAY=-1",state:"active"} as const;
  assert.equal(setRecurringPlanInputSchema.safeParse(value).success,true);
  assert.equal(setRecurringPlanInputSchema.safeParse({...value,recurrence_rule:"FREQ=MONTHLY;BYDAY=MO"}).success,false);
  assert.equal(setRecurringPlanInputSchema.safeParse({...value,next_due_on:"2026-01-01"}).success,false);
  assert.equal(setRecurringPlanInputSchema.safeParse({...value,cadence:"interval",interval_days:367,recurrence_rule:"FREQ=DAILY;INTERVAL=367"}).success,false);
});

test("money planning accepts only real calendar months",()=>{
  assert.equal(moneyPlanningInputSchema.safeParse({period:"2026-09"}).success,true);
  assert.equal(moneyPlanningInputSchema.safeParse({period:"0000-12"}).success,false);
  assert.equal(moneyPlanningInputSchema.safeParse({period:"2026-00"}).success,false);
  assert.equal(moneyPlanningInputSchema.safeParse({period:"2026-13"}).success,false);
});

test("overview contracts bound domains, dates and page sizes",()=>{
  assert.equal(lifeTodayInputSchema.safeParse({date:"2026-09-10",time_zone:"Asia/Shanghai",domains:["money","health"]}).success,true);
  assert.equal(lifeTodayInputSchema.safeParse({date:"2026-02-30",time_zone:"Asia/Shanghai"}).success,false);
  assert.equal(lifeTodayInputSchema.safeParse({date:"2026-09-10",time_zone:"Invalid/Zone"}).success,false);
  assert.equal(lifeTimelineInputSchema.safeParse({limit:100,domains:["meals"]}).success,true);
  assert.equal(lifeTimelineInputSchema.safeParse({limit:101}).success,false);
});

test("project directory accepts only bounded HTTPS launch targets",()=>{
  const item={id:"foliant",title:"Shadow Foliant",subtitle:"股票研究",launch_mode:"app_link",app_link_url:"https://foliant.example.com",web_fallback_url:"https://foliant.example.com",android_package:"com.shadow.foliant",state:"configured"} as const;
  assert.equal(projectDirectoryResultSchema.safeParse({items:[item]}).success,true);
  assert.equal(projectDirectoryResultSchema.safeParse({items:[{...item,app_link_url:"shadow-foliant://open"}]}).success,false);
  assert.equal(projectDirectoryResultSchema.safeParse({items:[{...item,app_link_url:null}]}).success,false);
  assert.equal(projectDirectoryResultSchema.safeParse({items:[{...item,launch_mode:"browser",app_link_url:null,web_fallback_url:null,android_package:null}]}).success,false);
});

test("health source status exposes the committed opaque cursor needed for device recovery",()=>{
  const value={items:[{id:"source_instance_12345678",source_type:"health_connect",instance_key:"android-hc-device",permission_state:"granted",sync_epoch:2,fingerprint:"permissions",cursors:[{device_id:"device",record_type:"body",cursor:"opaque-token",state:"active",sync_epoch:2,updated_at:"2026-09-10T00:00:00Z"}]}],as_of:"2026-09-10T00:00:01Z"};
  assert.deepEqual(healthSourcesResultSchema.parse(value),value);
  assert.equal(healthSourcesResultSchema.safeParse({...value,items:[{...value.items[0],cursors:[{...value.items[0]!.cursors[0],cursor:7}]}]}).success,false);
  const source={source_type:"health_connect",source_instance_key:"phone",source_fingerprint:"permissions",sync_epoch:2,permission_state:"rescan_required"} as const;
  assert.equal(setHealthSourceStateInputSchema.safeParse(source).success,true);
  assert.equal(setHealthSourceStateInputSchema.safeParse({...source,permission_state:"reset_required"}).success,false);
});

test("trip planning contracts preserve stable stop and runtime identities",()=>{assert.equal(setTripDayPlanInputSchema.safeParse({trip_id:"trip_12345678",plan_date:"2026-10-01",items:[{stop_id:"trip_stop_12345678",title:"西湖"}]}).success,true);assert.equal(publishTripPlanInputSchema.safeParse({trip_id:"trip_12345678",label:"出发版"}).success,true);assert.equal(setTripStopOutcomeInputSchema.safeParse({run_id:"trip_run_12345678",stop_id:"trip_stop_12345678",state:"arrived"}).success,true);assert.equal(setTripStopOutcomeInputSchema.safeParse({run_id:"trip_run_12345678",stop_id:"trip_stop_12345678",state:"pending"}).success,false);});
