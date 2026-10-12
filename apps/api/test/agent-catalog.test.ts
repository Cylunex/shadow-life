import assert from "node:assert/strict";
import test from "node:test";
import { QueryService, type UnitOfWork } from "@shadow/kernel";
import type { AgentRuntimeAdapter, RuntimeToolResult } from "@shadow/agent-adapter";
import { createApp } from "../src/app.js";

const headers = { authorization: "Bearer dev:subject_catalog", "content-type": "application/json" };
function dependencies() {
  const forbidden = () => { throw new Error("metadata must not execute or access persistence"); };
  return { unitOfWork: { ensurePrincipal: forbidden, pool: { query: forbidden } }, executor: { execute: forbidden }, queries: new QueryService({ read: forbidden, transaction: forbidden } as unknown as UnitOfWork), developmentAuth: true } as unknown as Parameters<typeof createApp>[0];
}
test("metadata routes authenticate and validate filters, with no SQL or command execution", async () => {
  const app = createApp(dependencies());
  for (const path of ["discover", "glossary", "scenarios", "catalog"]) {
    assert.equal((await app.request(`/api/agent/${path}`)).status, 401);
    assert.equal((await app.request(`/api/agent/${path}`, { headers })).status, 200);
  }
  const result = await (await app.request("/api/agent/discover?query=复购&read_only=true&include_schemas=true", { headers })).json() as any;
  assert.ok(result.capabilities.some((item: any) => item.name === "life.consumption_stats"));
  assert.ok(result.capabilities.every((item: any) => item.mode === "read"));
  for (const query of ["limit=999", "scenario=unknown", "read_only=yes", "offset=-1", "profile=admin"]) assert.equal((await app.request(`/api/agent/discover?${query}`, { headers })).status, 422);
  const validation = await app.request("/api/agent/tools/validate", { method: "POST", headers, body: JSON.stringify({ name: "money.record_entry", input: {} }) });
  assert.equal(validation.status, 200); const value = await validation.json() as any;
  assert.equal(value.valid, false); assert.equal(value.executed, false);
  assert.equal((await app.request("/api/capabilities/constructor", { headers })).status, 404);
  assert.equal((await app.request("/api/agent/tools/validate", { method: "POST", headers, body: JSON.stringify({ name: "__proto__", input: {} }) })).status, 404);
});

test("built-in assistant returns discovery to the runtime without creating a saved receipt", async () => {
  let submitted: RuntimeToolResult | undefined, sequence = 0;
  let discoveryContext: unknown;
  const runtime: AgentRuntimeAdapter = { id: "catalog", available: true,
    async *run(request) { discoveryContext = request.discoveryContext; yield { id: "discover", type: "tool.requested", runId: request.runId, capability: "agent.discover", input: { query: "照常" } }; },
    async *submitToolResult(request) { submitted = request; yield { id: "done", type: "run.completed", runId: request.runId }; }
  };
  const deps = dependencies(); deps.unitOfWork.ensurePrincipal = async () => undefined;
  deps.queries.agentPersonalContext = async () => ({ aliases: [], mealTemplates: [] });
  deps.queries.agentMemories = async () => ({ items: [], as_of: new Date().toISOString() });
  deps.agent = { repository: { assertThread: async () => undefined, conversation: async () => [], createRun: async () => undefined, heartbeat: async () => true, appendEvent: async () => ++sequence, finishRun: async () => undefined }, runtime, nextId: (type: string) => `${type}_12345678` } as any;
  const response = await createApp(deps).request("/api/threads/thread_12345678/runs", { method: "POST", headers, body: JSON.stringify({ text: "早餐照常" }) });
  const stream = await response.text(); assert.equal(response.status, 200);
  assert.equal(submitted?.capability, "agent.discover");
  assert.equal((discoveryContext as any).tools.length, 3);
  assert.ok((discoveryContext as any).tools.every((item: any) => item.inputSchema.type === "object"));
  assert.ok((submitted?.result as any).capabilities.some((item: any) => item.name === "life.food_catalog"));
  assert.doesNotMatch(stream, /operation\.committed/);
});
