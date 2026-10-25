import assert from "node:assert/strict";
import test from "node:test";
import {createApp} from "../src/app.js";
import {QueryService,type UnitOfWork} from "@shadow/kernel";

test("history HTTP route validates filters and requires authentication without reading unrelated data",async()=>{
  let captured:unknown,reads=0;
  const unitOfWork={read:async(work:any)=>{reads++;return work({moneyImportHistory:async(subjectId:string,input:unknown)=>{captured={subjectId,input};return{items:[],hasMore:false,asOf:"2026-10-25T00:00:00Z"}}});}} as unknown as UnitOfWork;
  const app=createApp({unitOfWork:{ensurePrincipal:async()=>{},pool:{query:async()=>({rows:[]})}},executor:{},queries:new QueryService(unitOfWork),developmentAuth:true} as unknown as Parameters<typeof createApp>[0]);
  const headers={authorization:"Bearer dev:subject_history"};
  const response=await app.request("/api/money/imports?platform=jd&source_account=family&status=review&limit=2",{headers});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{items:[],next_cursor:null,as_of:"2026-10-25T00:00:00Z"});
  assert.deepEqual(captured,{subjectId:"subject_history",input:{platform:"jd",source_account:"family",status:"review",limit:2}});
  for(const suffix of ["?limit=101","?platform=unknown","?cursor=broken","?subject_id=subject_other"]){assert.equal((await app.request(`/api/money/imports${suffix}`,{headers})).status,422);}
  assert.equal(reads,1);assert.equal((await app.request("/api/money/imports")).status,401);
});
