import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionRuntimeAdapter, type RuntimeEvent, type RuntimeRequest, type RuntimeToolResult } from "../src/index.js";

const request: RuntimeRequest = { threadId: "thread_model_test", runId: "run_model_test", messageId: "message_current", text: "记录午饭", history: [{ id: "message_current", role: "user", content: "记录午饭", createdAt: "2026-10-15T00:00:00Z" }], capabilityProfile: ["agent.discover", "life.record_meal"], discoveryContext: { catalogRevision: "test", instructions: [], tools: [{ name: "agent.discover", description: "discover", inputSchema: {} }] } };
const signal = () => new AbortController().signal;
const collect = async (events: AsyncIterable<RuntimeEvent>) => { const result = []; for await (const event of events) result.push(event); return result; };
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: "function", function: { name: `life_${name.replaceAll(".", "__")}`, arguments: JSON.stringify(args) } });
const reply = (calls?: unknown[], content = "已按回执记录") => ({ choices: [{ finish_reason: calls ? "tool_calls" : "stop", message: { content: calls ? null : content, ...(calls ? { tool_calls: calls, reasoning_content: "private reasoning" } : {}) } }] });
const discovered = { catalog_revision: "test", capabilities: [{ name: "life.record_meal", description: "meal", domain: "life", mode: "write", possible_effects: [], scenarios: [], matched_terms: [] }], terms: [], total: 1, next_offset: null, truncated: false };
function fixture(responses: unknown[]) {
  const bodies: any[] = [];
  const runtime = new ChatCompletionRuntimeAdapter({ url: "https://model.example.com/chat/completions", apiKey: "test-key", model: "test-model", fetcher: async (_url, options) => { bodies.push(JSON.parse(String(options?.body))); const next = responses.shift(); if (next instanceof Response) return next; return Response.json(next); } });
  return { runtime, bodies };
}
function result(toolCallId: string, capability: string, value: unknown): RuntimeToolResult { return { protocol: "shadow.runtime-tool-result", threadId: request.threadId, runId: request.runId, toolCallId, capability, result: value }; }

test("model discovers permitted tools, consumes real receipts and includes the user once", async () => {
  const { runtime, bodies } = fixture([reply([call("discover_1", "agent.discover")]), reply([call("write_1", "life.record_meal", { meal_type: "lunch" })]), reply()]);
  assert.equal((await collect(runtime.run(request, signal())))[0]?.type, "tool.requested");
  assert.equal(bodies[0].messages.filter((item: any) => item.content === request.text).length, 1);
  assert.equal(bodies[0].tools.length, 1);
  const write = await collect(runtime.submitToolResult(result("discover_1", "agent.discover", discovered), signal()));
  assert.equal(write[0]?.type, "tool.requested"); assert.equal((write[0] as any).capability, "life.record_meal");
  assert.equal(bodies[1].messages.find((item: any) => item.role === "assistant").reasoning_content, "private reasoning");
  const done = await collect(runtime.submitToolResult(result("write_1", "life.record_meal", { protocol: "shadow.execution", actual_values: { meal_id: "meal_saved" } }), signal()));
  assert.deepEqual(done.map(item => item.type), ["message.delta", "run.completed"]);
  assert.equal(bodies[2].messages.at(-1).role, "tool");
  assert.match(bodies[2].messages.at(-1).content, /meal_saved/);
  await assert.rejects(collect(runtime.submitToolResult(result("write_1", "life.record_meal", {}), signal())));
});

test("provider multi-tool responses execute serially without an extra call", async () => {
  const { runtime, bodies } = fixture([reply([call("a", "agent.discover"), call("b", "agent.discover")]), reply()]);
  await collect(runtime.run(request, signal()));
  const next = await collect(runtime.submitToolResult(result("a", "agent.discover", discovered), signal()));
  assert.equal(next[0]?.id, "b"); assert.equal(bodies.length, 1);
  await assert.rejects(collect(runtime.submitToolResult(result("a", "agent.discover", discovered), signal())));
  await collect(runtime.submitToolResult(result("b", "agent.discover", discovered), signal()));
  assert.equal(bodies.length, 2);
});

test("undiscovered, forbidden and duplicate calls cannot reach the Host", async () => {
  for (const calls of [[call("a", "life.record_meal")], [call("a", "money.void_entry")], [call("a", "agent.discover"), call("a", "agent.discover")]]) {
    const { runtime } = fixture([reply(calls)]);
    await assert.rejects(collect(runtime.run(request, signal())), /Model runtime failed/);
  }
  const { runtime } = fixture([reply([call("a", "agent.discover")]), reply([call("a", "agent.discover")])]);
  await collect(runtime.run(request, signal()));
  await assert.rejects(collect(runtime.submitToolResult(result("a", "agent.discover", discovered), signal())));
});

test("discovery cannot promote capabilities outside the request profile", async () => {
  const { runtime } = fixture([reply([call("a", "agent.discover")]), reply([call("b", "life.record_meal")])]);
  await collect(runtime.run({ ...request, capabilityProfile: ["agent.discover"] }, signal()));
  await assert.rejects(collect(runtime.submitToolResult(result("a", "agent.discover", discovered), signal())));
});

test("mismatched thread, run, call and capability continuations are rejected", async () => {
  const { runtime } = fixture([reply([call("a", "agent.discover")]), reply()]);
  await collect(runtime.run(request, signal()));
  const valid = result("a", "agent.discover", discovered);
  for (const invalid of [{ ...valid, threadId: "other" }, { ...valid, runId: "other" }, { ...valid, toolCallId: "other" }, { ...valid, capability: "life.record_meal" }]) await assert.rejects(collect(runtime.submitToolResult(invalid, signal())));
  assert.equal((await collect(runtime.submitToolResult(valid, signal()))).at(-1)?.type, "run.completed");
});

test("abort discards pending execution; provider failures redact secrets and do not retry", async () => {
  const { runtime, bodies } = fixture([new Response("test-key private provider error", { status: 401 })]);
  await assert.rejects(collect(runtime.run(request, signal())), error => { assert.doesNotMatch(String(error), /test-key|private provider/); return true; });
  assert.equal(bodies.length, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(collect(runtime.run(request, abort.signal)), /cancelled/);
  assert.equal(bodies.length, 1);
});

test("incomplete, invalid or oversized model answers never complete", async () => {
  for (const response of [{ choices: [{ finish_reason: "length", message: { content: "已保存" } }] }, reply(undefined, ""), reply([{ id: "a", type: "function", function: { name: "life_agent__discover", arguments: "bad json" } }]), new Response("x".repeat(2_000_001))]) {
    const { runtime } = fixture([response]); await assert.rejects(collect(runtime.run(request, signal())));
  }
});

test("long answers respect Runtime event size and model URLs require secure transport", async () => {
  const { runtime } = fixture([reply(undefined, "字".repeat(40_000))]);
  const events = await collect(runtime.run(request, signal()));
  assert.equal(events.length, 4); assert.ok(events.filter(item => item.type === "message.delta").every(item => item.text.length <= 16_384));
  assert.throws(() => new ChatCompletionRuntimeAdapter({ url: "http://model.example.com", apiKey: "key", model: "model" }));
});

test("multibyte context exceeding the byte budget never reaches the provider", async () => {
  const { runtime, bodies } = fixture([]);
  await assert.rejects(collect(runtime.run({ ...request, text: "字".repeat(700_000) }, signal())));
  assert.equal(bodies.length, 0);
});

test("explicit capability references expose only the permitted contract", async () => {
  const { runtime, bodies } = fixture([reply([call("meal_direct", "life.record_meal")]), reply()]);
  await collect(runtime.run({ ...request, text: "请用 life.record_meal，不要用 money.void_entry" }, signal()));
  assert.deepEqual(bodies[0].tools.map((tool: any) => tool.function.name), ["life_agent__discover", "life_life__record_meal"]);
  await collect(runtime.submitToolResult(result("meal_direct", "life.record_meal", {}), signal()));
});
