import assert from "node:assert/strict";
import test from "node:test";
import { loadDashboard } from "../src/dashboard.js";

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
