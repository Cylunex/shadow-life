import assert from "node:assert/strict";
import test from "node:test";
import { dailyRecordCheckInputSchema } from "@shadow/contracts";
import { buildDailyRecordCheck, type DailyRecordCheckRawData } from "../src/index.js";

const source={source_type:"samsung",instance_key:"phone",permission_state:"granted",cursor_states:["active"],last_sync_at:"2026-09-20T13:30:00.000Z"};
function raw(extra:Partial<DailyRecordCheckRawData>):DailyRecordCheckRawData{return{meals:[],purchases:{records:0,with_payment:0},money:{entries:0,expenses:0,income:0,refunds:0},health:{facts:0,by_kind:[],steps:null,sleep_target_on:"2026-09-19",sleep_sessions:0},sources:[source],as_of:"2026-09-20T14:30:00.000Z",...extra};}
const input=(date:string)=>dailyRecordCheckInputSchema.parse({date,time_zone:"Asia/Shanghai"});

test("2026-09-18 keeps recorded meals and actual steps instead of inventing zero",()=>{
  const result=buildDailyRecordCheck(raw({
    meals:[{meal_type:"breakfast",local_hour:8},{meal_type:"lunch",local_hour:12},{meal_type:"snack",local_hour:16},{meal_type:"dinner",local_hour:19}],
    health:{facts:27,by_kind:[{kind:"activity",count:1},{kind:"observation",count:26}],steps:14_444,sleep_target_on:"2026-09-17",sleep_sessions:1}
  }),input("2026-09-18"));
  assert.equal(result.meals.count,4);assert.equal(result.health.steps,14_444);assert.deepEqual(result.confirmed_omissions,[]);assert.deepEqual(result.actionable_messages,[]);
});

test("2026-09-19 reports a configured count gap without guessing a meal name",()=>{
  const result=buildDailyRecordCheck(raw({
    meals:[{meal_type:"dinner",local_hour:19}],
    health:{facts:31,by_kind:[{kind:"activity",count:1},{kind:"observation",count:30}],steps:1_911,sleep_target_on:"2026-09-18",sleep_sessions:1}
  }),input("2026-09-19"));
  assert.equal(result.meals.count,1);assert.equal(result.health.steps,1_911);assert.equal(result.confirmed_omissions.length,1);assert.equal(result.confirmed_omissions[0]?.code,"meal_records_below_minimum");assert.match(result.actionable_messages[0]!,/无法仅凭数量判断具体餐次/u);assert.doesNotMatch(result.actionable_messages[0]!,/早餐|午餐|晚餐/u);
});

test("2026-09-20 never treats same-night sleep or absent habits as omissions",()=>{
  const result=buildDailyRecordCheck(raw({
    meals:[{meal_type:"breakfast",local_hour:8},{meal_type:"lunch",local_hour:12},{meal_type:"dinner",local_hour:19}],
    health:{facts:12,by_kind:[{kind:"observation",count:11},{kind:"activity",count:1}],steps:3_200,sleep_target_on:"2026-09-19",sleep_sessions:0}
  }),input("2026-09-20"));
  assert.equal(result.health.sleep_check.wake_date,"2026-09-19");assert.equal(result.health.sleep_check.status,"awaiting_sync");assert.equal(result.health.by_kind.find(item=>item.kind==="habit")?.count,0);assert.deepEqual(result.health.goal_gaps,[]);assert.deepEqual(result.actionable_messages,[]);
});

test("only explicit source failures make an unsynced sleep check actionable",()=>{
  const result=buildDailyRecordCheck(raw({meals:[{meal_type:"breakfast",local_hour:8},{meal_type:"lunch",local_hour:12},{meal_type:"dinner",local_hour:19}],sources:[{...source,permission_state:"revoked",cursor_states:["revoked"]}]}),input("2026-09-20"));
  assert.equal(result.health.sleep_check.status,"sync_issue");assert.equal(result.confirmed_omissions.some(item=>item.domain==="meals"),false);assert.match(result.actionable_messages[0]!,/健康同步状态异常/u);
});

test("a configured meal type stays missing even when the total meal count is met",()=>{
  const configured=dailyRecordCheckInputSchema.parse({date:"2026-09-20",time_zone:"Asia/Shanghai",expectations:{minimum_meal_records:3,expected_meal_types:["breakfast"],minimum_purchase_records:0,minimum_money_entries:0}});
  const result=buildDailyRecordCheck(raw({meals:[{meal_type:"lunch",local_hour:12},{meal_type:"snack",local_hour:16},{meal_type:"dinner",local_hour:19}]}),configured);
  assert.equal(result.meals.expectation_status,"missing");assert.equal(result.confirmed_omissions[0]?.code,"expected_meal_type_missing");
});
