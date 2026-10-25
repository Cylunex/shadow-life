import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("workout progression route validates plan identity and reaches the shared query",async()=>{
  let captured:unknown;const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{workoutProgression:async(_context:unknown,input:unknown)=>{captured=input;return{plans:[],as_of:"2026-09-24T00:00:00Z"}}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const app=createApp(dependencies),headers={authorization:"Bearer dev:subject_test"};
  const response=await app.request("/api/health/workout-progression?plan_id=health_plan_12345678",{headers});
  assert.equal(response.status,200);assert.deepEqual(captured,{plan_id:"health_plan_12345678"});
  const invalid=await app.request("/api/health/workout-progression?plan_id=bad",{headers});
  assert.equal(invalid.status,422);
});
