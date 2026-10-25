import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("consumption statistics route parses range, filters and ranking basis",async()=>{
  let captured:unknown;const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{consumptionStats:async(_context:unknown,input:unknown)=>{captured=input;return{ok:true}}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/life/consumption-stats?from_on=2026-07-01&to_on_exclusive=2026-10-01&time_zone=Asia%2FShanghai&scopes=restaurant_delivery,grocery_delivery&categories=dish,staple&merchant_rank_by=net_spend&item_rank_by=line_spend&currency=CNY&limit=12",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,200);assert.deepEqual(captured,{from_on:"2026-07-01",to_on_exclusive:"2026-10-01",time_zone:"Asia/Shanghai",scopes:["restaurant_delivery","grocery_delivery"],categories:["dish","staple"],merchant_rank_by:"net_spend",item_rank_by:"line_spend",currency:"CNY",limit:12});
});

test("monetary ranking without currency is rejected before the query",async()=>{
  let called=false;const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>({}),getOperation:async()=>({})},queries:{consumptionStats:async()=>{called=true;return{}}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/life/consumption-stats?from_on=2026-07-01&to_on_exclusive=2026-10-01&time_zone=Asia%2FShanghai&merchant_rank_by=net_spend",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,422);assert.equal(called,false);
});
