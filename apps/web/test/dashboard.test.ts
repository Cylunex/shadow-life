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
