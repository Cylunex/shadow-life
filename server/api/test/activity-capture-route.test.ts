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
test("capture workspace and source detail routes share authenticated capability transport",async()=>{
 const calls:unknown[]=[];const app=createApp({unitOfWork:{},executor:{},queries:{captureWorkspace:async(_:unknown,input:unknown)=>{calls.push(input);return {recordings:[]};},activitySource:async(_:unknown,input:unknown)=>{calls.push(input);return {id:"activity_suite_one"};}},developmentAuth:true} as unknown as Parameters<typeof createApp>[0]);const headers={authorization:"Bearer dev:subject_activity"};
 const workspace=buildCapabilityHttpRequest("","life.capture_workspace",{date:"2026-10-30",time_zone:"UTC"});assert.equal((await app.request(workspace.url,{headers})).status,200);assert.deepEqual(calls[0],{date:"2026-10-30",time_zone:"UTC"});assert.equal((await app.request(workspace.url)).status,401);assert.equal((await app.request("/api/life/capture-workspace?date=2026-02-30&time_zone=UTC",{headers})).status,422);
 const source=buildCapabilityHttpRequest("","life.activity_source",{id:"activity_suite_one"});assert.equal((await app.request(source.url,{headers})).status,200);assert.deepEqual(calls[1],{id:"activity_suite_one"});
});
test("stay coordinates are complete and never accepted as application usage telemetry",()=>{
 const item={source_id:"stay_suite",kind:"stay",title:"合成地点",started_at:"2026-10-30T01:00:00Z",ended_at:"2026-10-30T02:00:00Z",time_zone:"UTC",latitude:31,longitude:121,accuracy_m:12};const parse=(v:unknown)=>ingestActivityInputSchema.safeParse({device_id:"device_suite",items:[v]}).success;
 assert.equal(parse(item),true);assert.equal(parse({...item,longitude:undefined}),false);assert.equal(parse({...item,kind:"app_usage",app_package:"example.shop"}),false);
});
