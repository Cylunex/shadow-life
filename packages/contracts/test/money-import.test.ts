import assert from "node:assert/strict";
import test from "node:test";
import {buildCapabilityHttpRequest,moneyImportHistoryInputSchema,stageMoneyImportInputSchema} from "../src/index.js";

test("statement sources carry explicit platform and stable account scope without breaking old inputs",()=>{
  const input={format:"csv",source_name:"账单.csv",content:"date,type,amount\n2026-10-01,expense,1.00",time_zone:"Asia/Shanghai"};
  assert.deepEqual(stageMoneyImportInputSchema.parse(input),input,"omitted defaults preserve existing command fingerprints");
  assert.equal(stageMoneyImportInputSchema.parse({...input,platform:"jd",source_account:" 家庭账户 "}).source_account,"家庭账户");
  for(const bad of [{platform:"unknown"},{source_account:" "},{source_account:"a".repeat(201)}])assert.equal(stageMoneyImportInputSchema.safeParse({...input,...bad}).success,false);
});
test("statement history exposes strict bounded filters through the shared HTTP contract",()=>{
  const request=buildCapabilityHttpRequest("https://life.example.com","money.import_history",{platform:"taobao",source_account:"家庭账户",status:"review",limit:10,cursor:"cursor+/="});
  const url=new URL(request.url);assert.equal(url.pathname,"/api/money/imports");assert.equal(url.searchParams.get("source_account"),"家庭账户");assert.equal(url.searchParams.get("cursor"),"cursor+/=");
  for(const bad of [{limit:0},{limit:101},{status:"pending"},{owner_id:"subject_other"}])assert.equal(moneyImportHistoryInputSchema.safeParse(bad).success,false);
});
