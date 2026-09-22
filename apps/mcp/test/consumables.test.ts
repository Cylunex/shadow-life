import assert from "node:assert/strict";
import test from "node:test";
import {reviewFixture,pgOnly} from "../../../packages/database/test/review-fixture.js";
import {LifeClient} from "../src/client.js";
import {createMcpServer} from "../src/server.js";
import {createApp} from "../../api/src/app.js";

test("personal MCP purchase creates a pending cycle and exposes actual-use tools",pgOnly,async t=>{
 const fixture=await reviewFixture(t),app=createApp({...fixture,developmentAuth:true});
 const handler=createMcpServer(new LifeClient({api:"http://life.example.com",token:`dev:${fixture.context.subjectId}`,profile:"personal",fetch:(url,init)=>app.request(String(url),init)}),[]);
 const request=async(method:string,params:unknown):Promise<any>=>handler(JSON.stringify({jsonrpc:"2.0",id:1,method,params}));
 const catalog=await request("tools/list",{});assert.ok(catalog.result.tools.some((t:{name:string})=>t.name==="money.record_consumable_use"));
 const result=await request("tools/call",{name:"life.record_purchase",arguments:{command_id:"cmd_mcp_coffee_purchase_01",input:{scene:"online_purchase",occurred_on:"2026-09-01",time_zone:"Asia/Shanghai",items:[{raw_name:"咖啡"}],consumables:[{item_position:0,quantity_unit:"count",quantity_label:"袋",initial_quantity:"80",expected_daily_usage:"1"}]}}});
 assert.equal(result.result.isError,undefined,JSON.stringify(result));assert.equal(result.result.structuredContent.actual_values.use_cycles_created,1);
 const planning=await request("tools/call",{name:"money.planning",arguments:{period:"2026-09"}});assert.equal(planning.result.structuredContent.use_cycles[0].usage_state,"pending");assert.equal(planning.result.structuredContent.use_cycles[0].remaining_quantity,null);
});
