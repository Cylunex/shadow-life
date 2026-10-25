import assert from "node:assert/strict";
import test from "node:test";
import { homeWorkoutMenu } from "@shadow/contracts";
import { blankSet, buildSessionWorkout, completedSetCount, emptyWorkout, readWorkoutDraft, restSeconds, validWorkoutSet, workoutDraftKey, type WorkoutDraft } from "../src/workout-session.js";
const press=homeWorkoutMenu.exercises.find(item=>item.id==="floor_press")!;
const timed=homeWorkoutMenu.exercises.find(item=>item.unit==="seconds")!;
const draft=():WorkoutDraft=>({...emptyWorkout("2026-10-18","Asia/Shanghai","chest","health_plan_test"),exercises:[{exercise:press,sets:[blankSet()]}]});
test("only explicitly completed sets become facts; load is per set",()=>{
  const input=draft();input.exercises[0]!.sets=[{value:"10",load:"4.5",completed:true},{value:"8",load:"5",completed:true},{value:"12",load:"9.5",completed:false}];
  const result=buildSessionWorkout(input),session=(result.detail as any).strength_session;
  assert.deepEqual(session.exercises[0].sets,[{reps:10,load_kg:"4.5"},{reps:8,load_kg:"5"}]);
  assert.equal(result.occurred_on,"2026-10-18");assert.equal(result.plan_id,"health_plan_test");assert.equal(result.duration_minutes,undefined);assert.equal(result.calories_kcal,undefined);
  input.exercises[0]!.sets.forEach(set=>set.completed=false);assert.equal(completedSetCount(input),0);assert.throws(()=>buildSessionWorkout(input));
});
test("timed and bodyweight sets retain their units without invented load",()=>{
  const input={...emptyWorkout("2026-10-18","Asia/Shanghai"),exercises:[{exercise:timed,sets:[{value:"20",load:"",completed:true}]}]};
  assert.deepEqual((buildSessionWorkout(input).detail as any).strength_session.exercises[0].sets,[{seconds:20}]);
  assert.equal(validWorkoutSet({value:"1e2",load:"",completed:false},press),false);
  assert.equal(validWorkoutSet({value:"-1",load:"",completed:false},press),false);
  assert.equal(validWorkoutSet({value:"10",load:"-2",completed:false},press),false);
});
test("draft reload preserves original date, completed flags, timer and account isolation",()=>{
  const input=draft();input.started=true;input.restUntil=100_000;input.exercises[0]!.sets=[{value:"10",load:"",completed:true}];
  const key=workoutDraftKey("account-a"),storage={getItem:(requested:string)=>requested===key?JSON.stringify(input):null};
  assert.deepEqual(readWorkoutDraft(storage,key),input);assert.equal(readWorkoutDraft(storage,workoutDraftKey("account-b")),null);
  assert.equal(restSeconds(100_000,99_001),1);assert.equal(restSeconds(100_000,160_000),0);
});
test("corrupt or ambiguous persisted drafts cannot replay as actual exercise",()=>{
  const storage=(input:unknown)=>({getItem:()=>JSON.stringify(input)});
  assert.equal(readWorkoutDraft(storage({...draft(),timeZone:"not-a-zone"}),"test"),null);
  const input=draft();input.exercises.push(input.exercises[0]!);assert.equal(readWorkoutDraft(storage(input),"test"),null);
  assert.equal(readWorkoutDraft(storage({...draft(),exercises:[{exercise:press,sets:[{value:"",load:"",completed:true}]}]}),"test"),null);
});
