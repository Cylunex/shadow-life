import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry } from "@shadow/contracts";
import { QueryService, type UnitOfWork } from "../../../packages/kernel/src/index.js";
import { createApp } from "../../api/src/app.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";

function fixture(scenario?: "travel") {
  const app = createApp({ unitOfWork: {}, executor: {}, queries: new QueryService({} as UnitOfWork), developmentAuth: true } as unknown as Parameters<typeof createApp>[0]);
  const request = ((url: string, init: RequestInit) => app.request(new URL(url).pathname + new URL(url).search, init)) as typeof fetch;
  return new LifeClient({ api: "https://life.example.com", token: "dev:subject_catalog", profile: "personal", ...(scenario ? { scenario } : {}), fetch: request });
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
