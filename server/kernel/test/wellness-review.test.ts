import assert from "node:assert/strict";
import test from "node:test";
import { dietDiaryKey, dietDiaryStatements, wellnessNutrients, wellnessReviewInputSchema, type WellnessDay } from "@shadow/contracts";
import { buildDietReview, type DietEvidence } from "../src/diet-review.js";
import { buildWellnessReview, shiftWellnessDate, wellnessWindow } from "../src/wellness-review.js";
const empty=(date:string):WellnessDay=>({date,meals:0,items:0,empty_meals:0,nutrients:Object.fromEntries(wellnessNutrients.map(key=>[key,{known_total:null,known_items:0,estimated_items:0}])) as WellnessDay["nutrients"],sleep:null,weight:null,workouts:{sessions:0,known_duration_sessions:0,minutes:null}});
test("bounded windows cross leap days and years without DST arithmetic",()=>{
  assert.deepEqual(wellnessWindow({to:"2024-03-01",days:7}),{from:"2024-02-24",previousFrom:"2024-02-17",previousTo:"2024-02-23"});
  assert.equal(shiftWellnessDate("2026-01-01",-1),"2025-12-31");
  for(const days of [0,8,365])assert.equal(wellnessReviewInputSchema.safeParse({to:"2026-10-23",days}).success,false);
  assert.equal(wellnessReviewInputSchema.safeParse({to:"0001-01-01"}).success,false);
});
test("means use only field-complete recorded days and preserve decimal precision",()=>{
  const rows=Array.from({length:14},(_,i)=>empty(shiftWellnessDate("2026-10-10",i)));
  for(const [i,value] of [[7,"9007199254740993.000001"],[8,"0.000001"]] as const){rows[i]!.items=1;rows[i]!.meals=1;rows[i]!.nutrients.energy_kcal={known_total:value,known_items:1,estimated_items:0};}
  const result=buildWellnessReview(rows,{to:"2026-10-23",days:7},"2026-10-23T00:00:00Z");
  assert.equal(result.current.nutrients.energy_kcal.known_total,"9007199254740993.000002");assert.equal(result.current.nutrients.energy_kcal.average_on_complete_days,"4503599627370496.500001");
  assert.equal(result.previous.nutrients.energy_kcal.known_total,null);assert.equal(result.current.average_sleep_minutes,null);
});

test("a low final day cannot suppress the follow-up supported by the 30-day diet review",()=>{
  const input={to:"2026-11-19",days:30,time_zone:"Asia/Shanghai"} as const;
  const days=Array.from({length:60},(_,i)=>empty(shiftWellnessDate(input.to,i-59)));
  const current=days.slice(-30);
  const evidence:DietEvidence={as_of:"2026-11-19T13:00:00Z",days,activity:[],menu:null,meals:[],measurements:[],intentions:[
    {id:"goal_energy",revision:1,key:"wellness.energy",statement:"每日热量 1600–2200 kcal",recheck:false},
    {id:"goal_weight",revision:1,key:"wellness.weight",statement:"维持体重",recheck:false},
  ]};
  for(const [i,day] of current.entries()){
    const energy=day.date===input.to?1000:1700;
    day.meals=day.items=1;
    day.nutrients.energy_kcal={known_total:String(energy),known_items:1,estimated_items:0};
    evidence.intentions.push({id:`diary_day_${i}`,revision:1,key:dietDiaryKey(day.date,input.time_zone),statement:dietDiaryStatements.complete,recheck:false});
    evidence.meals.push({id:`meal_day_${i}`,revision:1,date:day.date,type:"lunch",merchant:null,
      items:[{name:"合成午餐和含糖饮料",estimated:false,energy_kcal:energy,grams:null}]});
    evidence.measurements.push({id:`measure_day_${i}`,revision:1,date:day.date,occurred_at:`${day.date}T01:00:00Z`,
      source:"fixture_scale",session:`session_day_${i}`,metric:"weight",value:72+i/12,unit:"kg",method:null});
  }
  const singleLow=buildDietReview(evidence,input,true);
  assert.equal(singleLow.energy.status,"below");
  assert.equal(singleLow.weight?.trend,"up");
  assert.match(singleLow.weight_followup?.text??"",/含糖饮料/u);
  for(const day of current)day.nutrients.energy_kcal.known_total="1000";
  for(const meal of evidence.meals)meal.items[0]!.energy_kcal=1000;
  assert.match(buildDietReview(evidence,input,true).weight_followup?.text??"",/热量中位数低于自定范围/u);
});
