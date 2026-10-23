import assert from "node:assert/strict";
import test from "node:test";
import { wellnessNutrients, wellnessReviewInputSchema, type WellnessDay } from "@shadow/contracts";
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
