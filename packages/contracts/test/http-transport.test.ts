import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteQueryTransport, buildCapabilityHttpRequest } from "../src/index.js";

test("every published query has one HTTP transport",()=>assert.doesNotThrow(assertCompleteQueryTransport));
test("today and timeline use their real typed HTTP routes",()=>{const today=buildCapabilityHttpRequest("https://life.example.com/","life.today",{date:"2026-09-12",time_zone:"Asia/Shanghai",domains:["health","money"]});assert.equal(today.method,"GET");assert.equal(today.url,"https://life.example.com/api/today?date=2026-09-12&time_zone=Asia%2FShanghai&domains=health%2Cmoney");const timeline=buildCapabilityHttpRequest("https://life.example.com","life.timeline",{domains:["meals"],limit:30});assert.equal(timeline.url,"https://life.example.com/api/timeline?domains=meals&limit=30");});
test("write transports validate and construct the canonical command envelope",()=>{const request=buildCapabilityHttpRequest("https://life.example.com","money.record_entry",{command_id:"cmd_transport_12345678",input:{entry_type:"expense",amount:"12.30",currency:"CNY",occurred_on:"2026-09-12",time_zone:"Asia/Shanghai"}});assert.equal(request.method,"POST");assert.equal(JSON.parse(request.body!).protocol,"shadow.command");});
