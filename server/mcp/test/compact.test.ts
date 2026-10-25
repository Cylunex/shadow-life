import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { capabilityRegistry, type CapabilityName } from "@shadow/contracts";
import { QueryService, type UnitOfWork } from "../../kernel/src/index.js";
import { createApp } from "../../api/src/app.js";
import { LifeClient, type ClientOptions } from "../src/client.js";
import { createMcpServer } from "../src/server.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const catalog = (names: CapabilityName[]) => ({ capabilities: names.map(name => ({ name, description: capabilityRegistry[name].description })) });
const command = { capability: "money.record_entry", command_id: "cmd_compact_test_01", input: { entry_type: "expense", amount: "12.30", currency: "CNY", occurred_on: "2026-10-22", time_zone: "Asia/Shanghai" } };
const receipt = { protocol: "shadow.execution-result", capability: command.capability, command_id: command.command_id, execution_id: "execution_compact_01", status: "committed", result_kind: "record", resources: [{ type: "money_entry", id: "money_compact_01", revision: 1 }], actual_values: { amount: "12.30" }, warnings: [], replayed: false };
function setup(fetcher: typeof fetch, options: Partial<ClientOptions> = {}, roots: string[] = []) {
  const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: fetcher, ...options });
  const handle = createMcpServer(client, roots, "compact");
  const request = async (method: string, params?: unknown): Promise<any> => handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  return { client, request, call: (name: string, args: unknown) => request("tools/call", { name, arguments: args }) };
}

test("compact listing needs one metadata request and never downloads every tool schema", async () => {
  let calls = 0;
  const { request } = setup(async url => {
    calls++; assert.equal(String(url), "https://life.example.com/api/capabilities");
    return json(catalog(["agent.discover", "operations.find", "money.record_entry", "money.records", "health.ingest_raw", "library.capture"]));
  }, {}, ["/unused-media-root"]);
  const tools = (await request("tools/list")).result.tools;
  assert.equal(calls, 1);
  assert.deepEqual(tools.map((tool: any) => tool.name), ["assets.upload_local_image", "agent.discover", "operations.find", "life.query", "life.command"]);
  assert.equal(tools.find((tool: any) => tool.name === "life.query").annotations.readOnlyHint, true);
  assert.equal(tools.find((tool: any) => tool.name === "life.command").annotations.destructiveHint, true);
  const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.match(initialized.result.instructions, /mode=read call life.query/u);
});

test("catalog refresh removes revoked modes and upload, including an empty account", async () => {
  const catalogs: CapabilityName[][] = [["agent.discover", "money.record_entry", "library.capture"], ["money.records"], []];
  const { request } = setup(async () => json(catalog(catalogs.shift()!)), {}, ["/unused-media-root"]);
  assert.ok((await request("tools/list")).result.tools.some((tool: any) => tool.name === "life.command"));
  assert.deepEqual((await request("tools/list")).result.tools.map((tool: any) => tool.name), ["life.query"]);
  assert.deepEqual((await request("tools/list")).result.tools, []);
});

test("query dispatch preserves opaque cursor and exact typed result", async () => {
  const expected = { items: [], next_cursor: "next+page/==", as_of: "2026-10-22T00:00:00Z" };
  const { call } = setup(async (url, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(new URL(String(url)).searchParams.get("cursor"), "old+page/==");
    return json(expected);
  });
  const result = (await call("life.query", { capability: "life.list_meals", input: { limit: 10, cursor: "old+page/==" } })).result;
  assert.equal(result.isError, undefined); assert.deepEqual(result.structuredContent, expected);
});

test("write dispatch preserves envelope, receipt and subject-bound recovery without automatic retry", async () => {
  let writes = 0;
  const { call } = setup(async (url, init) => {
    if (init?.method === "POST") {
      writes++; assert.equal(String(url), "https://life.example.com/api/commands/money.record_entry");
      assert.deepEqual(JSON.parse(String(init.body)), { command_id: command.command_id, input: command.input });
      throw new Error("response lost after commit");
    }
    assert.equal(String(url), `https://life.example.com/api/operations/by-command/${command.command_id}`);
    return json(receipt);
  });
  const failed = (await call("life.command", command)).result.structuredContent;
  assert.equal(failed.capability, "money.record_entry"); assert.equal(failed.code, "outcome_unknown");
  assert.deepEqual(failed.recovery.arguments, { command_id: command.command_id });
  assert.deepEqual((await call(failed.recovery.tool, failed.recovery.arguments)).result.structuredContent, receipt);
  assert.equal(writes, 1);
});

test("wrong mode, malformed input, profile bypass and nested dispatcher never reach HTTP", async () => {
  let calls = 0;
  const { call } = setup(async () => { calls++; return json({}); });
  for (const [tool, args] of [
    ["life.query", { capability: "money.record_entry", input: command.input }],
    ["life.command", { ...command, capability: "life.today", input: {} }],
    ["life.command", { ...command, command_id: "bad" }],
    ["life.command", { ...command, input: { ...command.input, amount: "not-money" } }],
    ["life.query", { capability: "constructor", input: {} }],
    ["life.query", { capability: "life.query", input: {} }],
    ["life.command", { ...command, capability: "health.ingest_raw" }],
    ["life.command", { ...command, capability: "money.void_entry" }],
    ["life.command", { ...command, profile: "authorized" }]
  ] as const) assert.equal((await call(tool, args)).result.isError, true);
  assert.equal((await call("money.record_entry", command)).error.code, -32602);
  assert.equal(calls, 0);
});

test("generic dispatch cannot expand scenario, and server permission revocation still applies", async () => {
  const urls: URL[] = [];
  const { call } = setup(async url => {
    urls.push(new URL(String(url)));
    return json({ protocol: "shadow.error", code: "permission_denied", message: "Permission revoked" }, 403);
  }, { scenario: "health" });
  assert.equal((await call("life.command", command)).result.structuredContent.code, "permission_denied");
  assert.equal(urls.length, 0);
  const denied = await call("life.query", { capability: "agent.discover", input: { profile: "authorized", scenario: "spending", query: "哑铃" } });
  assert.equal(denied.result.structuredContent.code, "permission_denied"); assert.equal(urls.length, 1);
  assert.equal(urls[0]!.searchParams.get("profile"), "personal");
  assert.equal(urls[0]!.searchParams.get("scenario"), "health");
  assert.equal(urls[0]!.searchParams.get("query"), "哑铃");
});

test("real API discovery finds training schemas and compact bootstrap is substantially smaller", async () => {
  const app = createApp({ unitOfWork: {}, executor: {}, queries: new QueryService({} as UnitOfWork), developmentAuth: true } as unknown as Parameters<typeof createApp>[0]);
  const { client, request, call } = setup(((url: string, init: RequestInit) => app.request(url, init)) as typeof fetch, { token: "dev:subject_compact" });
  const full = await client.listTools(), compact = (await request("tools/list")).result.tools;
  assert.equal(compact.length, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)) / 10);
  const result = (await call("agent.discover", { query: "哑铃训练", scenario: "health", include_schemas: true })).result.structuredContent;
  for (const name of ["health.set_plan", "health.record_workout", "health.workout_progression"]) {
    assert.ok(full.some(tool => tool.name === name));
    assert.ok(result.capabilities.some((tool: any) => tool.name === name && tool.input_schema));
  }
  const readOnly = (await call("agent.discover", { query: "训练进度", read_only: true })).result.structuredContent;
  assert.ok(readOnly.capabilities.some((tool: any) => tool.name === "health.workout_progression"));
  assert.ok(readOnly.capabilities.every((tool: any) => tool.mode === "read"));
});

test("stdio compact configuration is explicit and rejects invalid toolsets", async () => {
  for (const toolset of ["compact", "invalid"]) {
    const child = spawn(process.execPath, ["--import", "tsx", new URL("../src/main.ts", import.meta.url).pathname], {
      env: { PATH: process.env.PATH!, SHADOW_API_URL: "https://life.example.com", SHADOW_ACCESS_TOKEN: "test-token", SHADOW_MCP_TOOLSET: toolset }, stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } }) + "\n");
    const status = await exited;
    if (toolset === "compact") { assert.equal(status, 0, stderr); assert.match(JSON.parse(stdout).result.instructions, /compact toolset/u); }
    else { assert.notEqual(status, 0); assert.match(stderr, /SHADOW_MCP_TOOLSET must be full or compact/u); assert.equal(stdout, ""); }
  }
});
