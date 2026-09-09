import assert from "node:assert/strict";
import test from "node:test";
import { ScriptedRuntimeAdapter, UnavailableRuntimeAdapter } from "../src/index.js";

test("unconfigured runtime reports interruption without affecting deterministic business", async () => {
  const adapter = new UnavailableRuntimeAdapter();
  const events = [];
  for await (const event of adapter.run({ threadId: "thread_00000001", runId: "run_00000001", messageId: "message_00000001", text: "午饭吃面", capabilityProfile: ["life.record_meal"] }, new AbortController().signal)) events.push(event);
  assert.equal(adapter.available, false);
  assert.equal(events[0]?.type, "run.interrupted");
});

test("tool result continuation returns validated model events",async()=>{
  const runId="run_00000001";const adapter=new ScriptedRuntimeAdapter([{id:"tool_1",type:"tool.requested",runId,capability:"money.summarize",input:{}}],[{id:"delta_1",type:"message.delta",runId,text:"净支出 80 元"},{id:"done_1",type:"run.completed",runId}]);
  const continued=[];for await(const event of adapter.submitToolResult({protocol:"shadow.runtime-tool-result",threadId:"thread_00000001",runId,toolCallId:"tool_1",capability:"money.summarize",result:{net_spending:"80"}},new AbortController().signal))continued.push(event);
  assert.equal(continued[0]?.type,"message.delta");assert.equal(continued[1]?.type,"run.completed");
});

test("runtime events reject missing type-specific fields",async()=>{
  const adapter=new ScriptedRuntimeAdapter([{id:"delta_1",type:"message.delta",runId:"run_00000001"} as never]);
  await assert.rejects(async()=>{for await(const _event of adapter.run({threadId:"thread_00000001",runId:"run_00000001",messageId:"message_00000001",text:"test",capabilityProfile:[]},new AbortController().signal)){/* consume */}});
});
