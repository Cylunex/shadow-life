import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkoutProgression } from "../src/workout-progression.js";
const session=(id:string,duration_minutes:number|null,rpe:number|null,session_type="run")=>({id,occurred_on:id==="b"?"2026-09-19":"2026-09-20",session_type,duration_minutes,rpe,revision:1});
const plan=(sessions:ReturnType<typeof session>[])=>buildWorkoutProgression([{id:"health_plan_1",title:"跑步",revision:1,sessions}]).plans[0]!;
test("training progression requires actual comparable execution",()=>{
  assert.equal(plan([]).status,"no_execution");
  assert.equal(plan([session("a",30,6)]).status,"missing_data");
  assert.equal(plan([session("a",30,null),session("b",30,6)]).next_duration_minutes,null);
  assert.equal(plan([session("a",30,6),session("b",30,6,"walk")]).status,"missing_data");
  assert.equal(plan([session("a",0,6),session("b",30,6)]).status,"missing_data");
  assert.equal(plan([session("a",30,8),session("b",30,6)]).status,"hold");
  assert.equal(plan([session("a",32,6),session("b",30,6)]).next_duration_minutes,34);
});
