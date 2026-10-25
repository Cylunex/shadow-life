import assert from "node:assert/strict";
import test from "node:test";
import { homeWorkoutMenu, recordWorkoutInputSchema, setHealthPlanInputSchema, strengthSessionSchema, workoutMenuSchema, workoutThemeForDate } from "../src/index.js";
const actual={version:1,focus:"chest",exercises:[{exercise:homeWorkoutMenu.exercises[6],sets:[{reps:10,load_kg:"4.5"},{reps:8,load_kg:"4.5"}]}]};
test("home menu offers ranked alternatives with no actual sets or forced completion",()=>{
  assert.deepEqual(homeWorkoutMenu.priorities,["chest","core","back_shoulders","arms","legs"]);
  assert.deepEqual(homeWorkoutMenu.days.map(day=>day.weekday),[1,2,4]);
  assert.equal(homeWorkoutMenu.exercises.length,40);
  assert.equal(workoutThemeForDate(homeWorkoutMenu,"2026-10-20"),"core");assert.equal(workoutThemeForDate(homeWorkoutMenu,"2026-10-22"),"chest");
  for(const focus of homeWorkoutMenu.priorities){const entries=homeWorkoutMenu.exercises.filter(item=>item.focus===focus);assert.ok(entries.some(item=>item.equipment==="bodyweight"));assert.ok(entries.some(item=>item.equipment==="dumbbell"));assert.ok(entries.some(item=>item.difficulty==="easy"));assert.ok(entries.some(item=>item.difficulty!=="easy"));}
  assert.equal(homeWorkoutMenu.exercises.find(item=>item.id==="reverse_fly")?.focus,"back_shoulders");
  assert.equal(workoutMenuSchema.safeParse({...homeWorkoutMenu,priorities:["chest","chest","core","arms","legs"]}).success,false);
  assert.equal(workoutMenuSchema.safeParse({...homeWorkoutMenu,exercises:[homeWorkoutMenu.exercises[0],homeWorkoutMenu.exercises[0]]}).success,false);
});
test("all entrypoints validate the same structured menu and actual execution detail",()=>{
  const plan={kind:"workout",name:"自选",state:"active",schedule:{days:[1,2,4]},detail:{note:"保留备注",workout_menu:homeWorkoutMenu}};
  assert.ok(setHealthPlanInputSchema.safeParse(plan).success);
  assert.equal(setHealthPlanInputSchema.safeParse({...plan,detail:{strength_session:actual}}).success,false);
  assert.equal(setHealthPlanInputSchema.safeParse({...plan,detail:{workout_menu:{version:1}}}).success,false);
  assert.ok(recordWorkoutInputSchema.safeParse({occurred_on:"2026-10-16",time_zone:"Asia/Shanghai",session_type:"strength_training",detail:{strength_session:actual}}).success);
  assert.equal(recordWorkoutInputSchema.safeParse({occurred_on:"2026-10-16",time_zone:"Asia/Shanghai",session_type:"strength_training",detail:{workout_menu:homeWorkoutMenu}}).success,false);
  assert.equal(recordWorkoutInputSchema.safeParse({occurred_on:"2026-10-16",time_zone:"Asia/Shanghai",session_type:"run",detail:{strength_session:actual}}).success,false);
  assert.equal(strengthSessionSchema.safeParse({...actual,exercises:[]}).success,false);
  assert.equal(strengthSessionSchema.safeParse({...actual,exercises:[{exercise:homeWorkoutMenu.exercises[6],sets:[{seconds:20}]}]}).success,false);
  assert.equal(strengthSessionSchema.safeParse({...actual,exercises:[{exercise:homeWorkoutMenu.exercises[0],sets:[{reps:10,load_kg:"4"}]}]}).success,false);
  assert.ok(setHealthPlanInputSchema.safeParse({...plan,detail:{note:"旧版自由备注"}}).success);
});
