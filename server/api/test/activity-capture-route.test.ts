import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { buildCapabilityHttpRequest,ingestActivityInputSchema } from "@shadow/contracts";
test("activity HTTP query validates local dates, timezones and pagination before querying",async()=>{
 let captured:unknown;
 const app=createApp({unitOfWork:{},executor:{},queries:{activities:async(_context:unknown,input:unknown)=>{captured=input;return{items:[]};}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0]);
 const request=buildCapabilityHttpRequest("","life.activities",{date:"2026-10-30",time_zone:"Asia/Shanghai"}),headers={authorization:"Bearer dev:subject_activity"};
 assert.equal((await app.request(request.url,{headers})).status,200);
 assert.deepEqual(captured,{date:"2026-10-30",time_zone:"Asia/Shanghai",limit:50});
 assert.equal((await app.request(request.url)).status,401);
 assert.equal((await app.request("/api/life/activities?date=2026-02-30&time_zone=UTC",{headers})).status,422);
 assert.equal((await app.request("/api/life/activities?date=2026-10-30&time_zone=invalid",{headers})).status,422);
 assert.equal((await app.request(request.url.replace("limit=50","limit=101"),{headers})).status,422);
});
test("capture contracts reject duplicate identities, incomplete intervals and screen text in usage events",()=>{
 const item={source_id:"usage_one",kind:"app_usage",title:"Browser",app_package:"example.browser",started_at:"2026-10-30T01:00:00Z",ended_at:"2026-10-30T02:00:00Z",time_zone:"UTC"};
 const parse=(items:unknown[])=>ingestActivityInputSchema.safeParse({device_id:"device_test",items}).success;
 assert.equal(parse([item]),true);assert.equal(parse([item,item]),false);
 assert.equal(parse([{...item,ended_at:item.started_at}]),false);
 assert.equal(parse([{...item,text:"private content"}]),false);
 assert.equal(parse([{...item,app_package:undefined}]),false);
});
