import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { buildCapabilityHttpRequest } from "@shadow/contracts";
test("wellness HTTP query shares typed input and rejects invalid periods",async()=>{
  let captured:unknown;
  const app=createApp({unitOfWork:{},executor:{},queries:{wellnessReview:async(_context:unknown,input:unknown)=>{captured=input;return{}}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0]);
  const request=buildCapabilityHttpRequest("","life.wellness_review",{to:"2026-10-23"}),headers={authorization:"Bearer dev:subject_wellness"};
  assert.equal((await app.request(request.url,{headers})).status,200);assert.deepEqual(captured,{to:"2026-10-23",days:7});
  assert.equal((await app.request("/api/life/wellness-review?to=2026-10-23&days=365",{headers})).status,422);
  assert.equal((await app.request(request.url)).status,401);
});
