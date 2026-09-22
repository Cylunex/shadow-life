import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "../../../packages/database/test/review-fixture.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { createApp } from "../../api/src/app.js";

test("personal MCP exposes service cards and recovers a lost redemption response without double charging",pgOnly,async t=>{
  const fixture=await reviewFixture(t),app=createApp({...fixture,developmentAuth:true});let drop=true;
  const client=new LifeClient({api:"http://life.example.com",token:`dev:${fixture.context.subjectId}`,profile:"personal",fetch:async(url,init)=>{
    const response=await app.request(String(url),init);
    if(String(url).includes("/commands/money.record_service_card_use")&&drop){assert.equal(response.status,201,await response.clone().text());drop=false;throw new TypeError("response lost after commit");}
    return response;
  }});
  const handler=createMcpServer(client,[]);
  const request=async(method:string,params:unknown):Promise<any>=>handler(JSON.stringify({jsonrpc:"2.0",id:1,method,params}));
  const call=async(name:string,args:unknown)=>request("tools/call",{name,arguments:args});
  const catalog=await request("tools/list",{});
  for(const name of ["money.save_service_card","money.record_service_card_use","money.service_cards"])assert.ok(catalog.result.tools.some((tool:{name:string})=>tool.name===name));
  const created=await call("money.save_service_card",{command_id:"cmd_mcp_haircut_card_001",input:{name:"测试理发卡",total_units:8,started_on:"2026-09-01"}});
  assert.equal(created.result.isError,undefined,JSON.stringify(created));const id=created.result.structuredContent.actual_values.card_id;
  const args={command_id:"cmd_mcp_haircut_use_001",input:{card_id:id,expected_revision:1,occurred_on:"2026-09-02",units:1}};
  const unknown=await call("money.record_service_card_use",args);assert.equal(unknown.result.structuredContent.code,"outcome_unknown");
  const recovered=await call("operations.find",{command_id:args.command_id});assert.equal(recovered.result.structuredContent.status,"committed");
  const replay=await call("money.record_service_card_use",args);assert.equal(replay.result.structuredContent.replayed,true);
  const detail=await call("money.service_cards",{id});assert.equal(detail.result.isError,undefined,JSON.stringify(detail));
  assert.equal(detail.result.structuredContent.items[0].remaining_units,7);assert.equal(detail.result.structuredContent.items[0].uses.length,1);
  assert.equal((await fixture.pool.query("select count(*)::int count from money_entries")).rows[0].count,0);
  const anonymous=await app.request("/api/money/service-cards");assert.equal(anonymous.status,401);
});
