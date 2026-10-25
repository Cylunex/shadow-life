import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry, type McpProfile } from "@shadow/contracts";
import { QueryService, type UnitOfWork } from "../../kernel/src/index.js";
import { createApp } from "../../api/src/app.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";

function fixture(scenario?: "travel", profile: McpProfile = "personal") {
  const app = createApp({ unitOfWork: {}, executor: {}, queries: new QueryService({} as UnitOfWork), developmentAuth: true } as unknown as Parameters<typeof createApp>[0]);
  const request = ((url: string, init: RequestInit) => app.request(new URL(url).pathname + new URL(url).search, init)) as typeof fetch;
  return new LifeClient({ api: "https://life.example.com", token: "dev:subject_catalog", profile, ...(scenario ? { scenario } : {}), fetch: request });
}
test("MCP discovery schemas, pagination and profile scope match the actual callable catalog", async () => {
  const client = fixture(), tools = await client.listTools();
  assert.ok(tools.some(tool => tool.name === "agent.discover"));
  const names = new Set(tools.map(tool => tool.name));
  const result = await client.call("agent.catalog", {}) as any;
  assert.ok(result.capabilities.every((item: any) => names.has(item.name)));
  assert.ok(!result.capabilities.some((item: any) => item.name === "life.void_purchase"));
  assert.ok(result.capabilities.length < Object.keys(capabilityRegistry).length);
});
test("Hermes can discover the money void tool by the user's wording", async () => {
  const client = fixture(undefined, "personal-money-void");
  const tools = await client.listTools();
  assert.ok(tools.some(tool => tool.name === "money.void_entry"));
  const found = await client.call("agent.discover", { query: "账目作废" }) as any;
  assert.equal(found.capabilities[0]?.name, "money.void_entry");
  assert.ok(!found.capabilities.some((item: any) => item.name === "life.void_purchase"));
});
test("travel MCP narrows listing, calls and metadata, even if arguments request another profile or scenario", async () => {
  const client = fixture("travel"), tools = await client.listTools(), names = new Set(tools.map(tool => tool.name));
  assert.ok(names.has("travel.set_day_plan") && names.has("operations.find") && names.has("agent.discover"));
  assert.ok(!names.has("money.record_entry"));
  const result = await client.call("agent.discover", { profile: "authorized", scenario: "daily", limit: 30 }) as any;
  assert.ok(result.capabilities.every((item: any) => names.has(item.name)));
  const snapshot = await client.call("agent.catalog", { profile: "authorized", scenario: "spending" }) as any;
  assert.ok(snapshot.capabilities.every((item: any) => names.has(item.name)));
  await assert.rejects(() => client.call("money.record_entry", {}));
  const handle = createMcpServer(client);
  const rejected = await handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "money.record_entry", arguments: {} } })) as any;
  assert.equal(rejected.error.code, -32602);
});

test("invalid input returns a directly callable schema lookup without submitting a command", async () => {
  let requests = 0;
  const client = new LifeClient({ api: "https://life.example.com", token: "test", profile: "personal", fetch: (async () => { requests++; throw new Error("must not submit"); }) as typeof fetch });
  for (const toolset of ["full", "compact"] as const) {
    const handle = createMcpServer(client, [], toolset);
    const input = { command_id: "cmd_bad_budget_amount", input: { period: "2026-10", amount: "oops", currency: "CNY" } };
    const result = await handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: toolset === "full" ? { name: "money.set_budget", arguments: input } : { name: "life.command", arguments: { capability: "money.set_budget", ...input } } })) as any;
    assert.equal(result.result.isError, true);
    assert.deepEqual(result.result.structuredContent.recovery.schema_lookup, { tool: "agent.discover", arguments: { names: ["money.set_budget"], include_schemas: true } });
    assert.ok(result.result.structuredContent.fields.some((field: string) => field.includes("amount")));
  }
  assert.equal(requests, 0);
});

test("health and nutrition review is discoverable in personal MCP with exact input schema",async()=>{
  const client=fixture(),result=await client.call("agent.discover",{query:"饮食复盘",include_schemas:true}) as any;
  assert.equal(result.capabilities[0]?.name,"life.wellness_review");
  assert.ok((await client.listTools()).some(tool=>tool.name==="life.wellness_review"));
});
