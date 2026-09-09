import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry, commandEnvelopeSchema, publishTripPlanInputSchema, recordDiningInputSchema, recordMealInputSchema, setHealthPlanInputSchema, setRecurringPlanInputSchema, setTripDayPlanInputSchema, setTripStopOutcomeInputSchema, universalCommandEnvelopeSchema } from "../src/index.js";

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

test("trip planning contracts preserve stable stop and runtime identities",()=>{assert.equal(setTripDayPlanInputSchema.safeParse({trip_id:"trip_12345678",plan_date:"2026-10-01",items:[{stop_id:"trip_stop_12345678",title:"西湖"}]}).success,true);assert.equal(publishTripPlanInputSchema.safeParse({trip_id:"trip_12345678",label:"出发版"}).success,true);assert.equal(setTripStopOutcomeInputSchema.safeParse({run_id:"trip_run_12345678",stop_id:"trip_stop_12345678",state:"arrived"}).success,true);assert.equal(setTripStopOutcomeInputSchema.safeParse({run_id:"trip_run_12345678",stop_id:"trip_stop_12345678",state:"pending"}).success,false);});
