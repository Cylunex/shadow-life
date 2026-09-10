import assert from "node:assert/strict";
import test from "node:test";
import { loadDashboard, loadHealthTrend } from "../src/dashboard.js";

function response(value:unknown,status=200):Response{return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});}

test("dashboard loads only authorized domains and keeps sibling successes",async()=>{
  const calls:string[]=[];const fetcher=async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);if(url==="/api/write-epochs")return response({items:[{domain:"health",epoch:2}]});if(url==="/api/capabilities")return response({capabilities:[{name:"money.records"},{name:"health.records"}]});if(url==="/api/money")return response({items:[{id:"money_1"}]});if(url==="/api/health")return response({message:"denied"},403);throw new Error(`unexpected ${url}`);};
  const result=await loadDashboard(fetcher as typeof fetch,{});
  assert.deepEqual(calls.sort(),["/api/capabilities","/api/health","/api/money","/api/write-epochs"]);assert.deepEqual(result.data.money,[{id:"money_1"}]);assert.equal(result.data.meals,undefined);assert.equal(result.errors.health,"HTTP 403");assert.equal(result.epochHeader,"health=2");
});

test("capability failure is explicit because safe domain selection is unknown",async()=>{
  const fetcher=async(input:RequestInfo|URL)=>String(input)==="/api/capabilities"?response({},401):response({items:[]});
  await assert.rejects(()=>loadDashboard(fetcher as typeof fetch,{}),/登录已失效/u);
});

test("dashboard prefers server-side daily metrics and unified timeline",async()=>{
  const calls:string[]=[];const fetcher=async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);if(url==="/api/write-epochs")return response({items:[]});if(url==="/api/capabilities")return response({capabilities:[{name:"life.today"},{name:"life.timeline"}]});if(url.startsWith("/api/today?"))return response({date:"2026-09-10",domains:{meals:{count:7,freshness:null}},as_of:"2026-09-10T00:00:00Z"});if(url==="/api/timeline?limit=30")return response({items:[{domain:"meals",kind:"meal",id:"meal_12345678",happened_at:"2026-09-10T01:00:00Z",title:"早餐"}],next_cursor:null,as_of:"2026-09-10T02:00:00Z"});throw new Error(`unexpected ${url}`);};
  const result=await loadDashboard(fetcher as typeof fetch,{}, {date:"2026-09-10",timeZone:"Asia/Shanghai"});assert.equal(result.today?.domains.meals?.count,7);assert.equal(result.timeline?.items[0]?.id,"meal_12345678");assert.equal(calls.some(url=>url.includes("time_zone=Asia%2FShanghai")),true);
});

test("dashboard loads every authorized health workspace section",async()=>{
  const calls:string[]=[];const fetcher=async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);if(url==="/api/write-epochs")return response({items:[]});if(url==="/api/capabilities")return response({capabilities:[{name:"health.daily"},{name:"health.trend"},{name:"health.sources"}]});if(url==="/api/health/daily/2026-09-10")return response({occurred_on:"2026-09-10",algorithm_version:"health-normalizer",result:{facts:[]},revision:1});if(url==="/api/health/trend?metric_key=weight&limit=90")return response({metric_key:"weight",points:[{id:"health_12345678",occurred_on:"2026-09-10",value:"68.4",unit:"kg",source_kind:"manual",revision:1}],coverage:{from:"2026-09-10",to:"2026-09-10",points:1,truncated:false},as_of:"2026-09-10T01:00:00Z"});if(url==="/api/health/sources")return response({items:[{id:"source_12345678",source_type:"health_connect",instance_key:"phone",permission_state:"granted",sync_epoch:2,fingerprint:"opaque",cursors:[{device_id:"device",record_type:"body",cursor:"must-not-be-copied",state:"active",sync_epoch:2,updated_at:"2026-09-10T01:00:00Z"}]}],as_of:"2026-09-10T01:00:00Z"});throw new Error(`unexpected ${url}`);};
  const result=await loadDashboard(fetcher as typeof fetch,{}, {date:"2026-09-10",timeZone:"Asia/Shanghai"});
  assert.equal(result.health?.daily?.occurred_on,"2026-09-10");assert.equal(result.health?.trend?.points[0]?.value,"68.4");assert.equal(result.health?.sources?.[0]?.cursors[0]?.record_type,"body");assert.deepEqual(result.capabilities,["health.daily","health.sources","health.trend"]);assert.equal(calls.length,5);
});

test("a missing daily summary is an empty state while other health reads remain usable",async()=>{
  const fetcher=async(input:RequestInfo|URL)=>{const url=String(input);if(url==="/api/write-epochs")return response({items:[]});if(url==="/api/capabilities")return response({capabilities:[{name:"health.daily"},{name:"health.trend"}]});if(url.startsWith("/api/health/daily/"))return response({message:"not found"},404);if(url.startsWith("/api/health/trend?"))return response({metric_key:"weight",points:[],coverage:{from:null,to:null,points:0,truncated:false},as_of:"2026-09-10T01:00:00Z"});throw new Error(`unexpected ${url}`);};
  const result=await loadDashboard(fetcher as typeof fetch,{}, {date:"2026-09-10"});assert.equal(result.health?.daily,undefined);assert.deepEqual(result.health?.errors,{});assert.equal(result.health?.trend?.coverage.points,0);
});

test("health trend selection safely encodes the metric",async()=>{
  let requested="";const fetcher=async(input:RequestInfo|URL)=>{requested=String(input);return response({metric_key:"blood glucose",points:[],coverage:{from:null,to:null,points:0,truncated:false},as_of:"2026-09-10T01:00:00Z"});};
  await loadHealthTrend(fetcher as typeof fetch,{},"blood glucose");assert.equal(requested,"/api/health/trend?metric_key=blood%20glucose&limit=90");
});
