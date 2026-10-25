import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityHttpRequest } from "@shadow/contracts";
import { createApp } from "../src/app.js";

test("deadline assessment date and time zone survive the shared CLI/MCP HTTP transport",async()=>{
  const inputs:unknown[]=[];
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{ownedItems:async(_context:unknown,input:unknown)=>{inputs.push(input);return{};},mealPlanning:async(_context:unknown,input:unknown)=>{inputs.push(input);return{};}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const app=createApp(dependencies),headers={authorization:"Bearer dev:subject_test"};
  for(const capability of ["life.owned_items","life.meal_planning"] as const){
    const request=buildCapabilityHttpRequest("http://localhost",capability,{on:"2026-10-22",time_zone:"America/Los_Angeles",limit:3});
    assert.equal(request.method,"GET");const response=await app.request(request.url,{headers});assert.equal(response.status,200);
  }
  assert.deepEqual(inputs,[{on:"2026-10-22",time_zone:"America/Los_Angeles",limit:3},{on:"2026-10-22",time_zone:"America/Los_Angeles",limit:3}]);
  assert.throws(()=>buildCapabilityHttpRequest("http://localhost","life.meal_planning",{on:"2026-02-30"}));
  assert.throws(()=>buildCapabilityHttpRequest("http://localhost","life.owned_items",{time_zone:"Invalid/Zone"}));
});
