import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { z } from "zod";
import { capabilityRegistry, commandId, type CapabilityName } from "@shadow/contracts";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { personalOperatorTools } from "../src/profile.js";

const receipt = { protocol: "shadow.execution-result", capability: "money.record_entry", command_id: "cmd_mcp_receipt_0001", execution_id: "execution_00000001", status: "committed", result_kind: "record", resources: [{ type: "money_entry", id: "money_00000001", revision: 1 }], actual_values: { amount: "12.30" }, warnings: [], replayed: false };
const command = { command_id: receipt.command_id, input: { entry_type: "expense", amount: "12.30", currency: "CNY", occurred_on: "2026-09-22", time_zone: "Asia/Shanghai" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(fetcher: typeof fetch, roots: string[] = []) {
  const client = new LifeClient({ api: "https://life.example.com", token: "test-token", profile: "personal", fetch: fetcher });
  const handler = createMcpServer(client, roots);
  return { client, request: async (method: string, params?: unknown): Promise<any> => handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })), handler };
}
function catalog(names: CapabilityName[], schemas = true) { return { capabilities: names.map(name => ({ name, description: capabilityRegistry[name].description, ...(schemas ? { input_schema: z.toJSONSchema(capabilityRegistry[name].inputSchema) } : {}) })) }; }

test("one discovery request exposes real idempotency schema and only server-visible personal tools", async () => {
  let calls = 0;
  const { request } = setup(async (url, init) => { calls++; assert.equal(String(url), "https://life.example.com/api/capabilities?include_schemas=true"); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token"); return json(catalog(["life.record_meal", "life.void_purchase", "health.ingest_raw", "operations.find", "life.save_project"])); });
  const { result } = await request("tools/list");
  assert.equal(calls, 1);
  assert.deepEqual(result.tools.map((tool: any) => tool.name), ["life.record_meal", "operations.find", "life.save_project"]);
  const key = result.tools[0].inputSchema.properties.command_id;
  assert.equal(key.pattern, z.toJSONSchema(commandId).pattern);
  assert.equal(new RegExp(key.pattern).test("breakfast-1"), false);
  assert.equal(new RegExp(key.pattern).test("cmd_breakfast_001"), true);
  assert.equal(result.tools[1].annotations.readOnlyHint, true);
});

test("old API fallback has bounded concurrency and catalog refresh drops revoked visibility", async () => {
  let active = 0, peak = 0, lists = 0;
  const names: CapabilityName[] = ["life.record_meal", "life.record_purchase", "life.record_dining", "life.today", "life.list_meals", "money.summarize"];
  const { request } = setup(async url => {
    if (String(url).includes("include_schemas")) return json(catalog(++lists === 1 ? names : [], false));
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return json({ input_schema: { type: "object" } });
  });
  assert.equal((await request("tools/list")).result.tools.length, 6);
  assert.ok(peak <= 4);
  assert.equal((await request("tools/list")).result.tools.length, 0);
});

test("Hermes malformed key and estimates return actionable tool errors without submitting", async () => {
  let calls = 0;
  const { request } = setup(async () => { calls++; return json({}); });
  const response = await request("tools/call", { name: "life.record_meal", arguments: { command_id: "breakfast", input: { occurred_on: "2026-09-22", time_zone: "Asia/Shanghai", meal_type: "breakfast", items: [{ name: "燕麦", estimate: true }] } } });
  assert.equal(calls, 0); assert.equal(response.error, undefined); assert.equal(response.result.isError, true);
  const error = response.result.structuredContent;
  assert.equal(error.code, "validation"); assert.ok(error.fields.includes("command_id"));
  assert.ok(error.issues.some((issue: any) => issue.message.includes("evidence_note")));
});

test("receipt recovery after a lost write response never repeats the write automatically", async () => {
  let writes = 0;
  const { request } = setup(async (url, init) => {
    if (init?.method === "POST") { writes++; throw new TypeError("connection dropped after commit"); }
    assert.equal(String(url), `https://life.example.com/api/operations/by-command/${command.command_id}`);
    return json(receipt);
  });
  const failed = (await request("tools/call", { name: "money.record_entry", arguments: command })).result;
  assert.equal(failed.isError, true); assert.equal(failed.structuredContent.code, "outcome_unknown");
  assert.equal(writes, 1);
  const recovered = await request("tools/call", { name: failed.structuredContent.recovery.tool, arguments: failed.structuredContent.recovery.arguments });
  assert.deepEqual(recovered.result.structuredContent, receipt); assert.equal(writes, 1);
});

test("malformed success and non-JSON upstream failures never masquerade as input validation or success", async () => {
  for (const response of [json({ status: "ok" }), new Response("<html>private proxy details</html>", { status: 502 })]) {
    const { request } = setup(async () => response);
    const result = (await request("tools/call", { name: "money.record_entry", arguments: command })).result;
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, "outcome_unknown");
    assert.doesNotMatch(JSON.stringify(result), /private proxy details/u);
  }
});

test("business conflict and permission errors preserve server fields and recovery guidance", async () => {
  for (const [code, status, action] of [["conflict", 409, "read_current_record"], ["permission_denied", 403, "check_connection"]] as const) {
    const { request } = setup(async () => json({ protocol: "shadow.error", code, message: "Cannot apply command", fields: ["input.expected_revision"] }, status));
    const result = (await request("tools/call", { name: "money.record_entry", arguments: command })).result;
    assert.equal(result.structuredContent.code, code); assert.equal(result.structuredContent.recovery.action, action);
    assert.deepEqual(result.structuredContent.fields, ["input.expected_revision"]);
  }
});

test("meal cursor reaches the API unchanged", async () => {
  const { client } = setup(async url => { assert.equal(new URL(String(url)).searchParams.get("cursor"), "page+two/=="); return json({ items: [], next_cursor: null, as_of: "2026-09-22T00:00:00Z" }); });
  await client.call("life.list_meals", { limit: 20, cursor: "page+two/==" });
});

test("JSON-RPC negotiation, ping, malformed input, notifications and unknown tools behave correctly", async () => {
  let calls = 0;
  const { request, handler } = setup(async () => { calls++; return json({}); });
  const initialized = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(initialized.result.protocolVersion, "2024-11-05"); assert.ok(initialized.result.instructions.length > 0);
  assert.deepEqual((await request("ping")).result, {});
  assert.equal((await handler("{") as any).error.code, -32700);
  assert.equal((await handler("null") as any).error.code, -32600);
  assert.equal(await handler(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled" })), undefined);
  assert.equal((await request("tools/call", { name: "toString" })).error.code, -32602);
  assert.equal((await request("tools/call", { name: "health.ingest_raw" })).error.code, -32602);
  assert.equal((await request("tools/call", { name: "life.void_purchase" })).error.code, -32602);
  assert.equal(calls, 0);
});

test("personal profile contains supported planning tools and excludes administration", () => {
  for (const name of personalOperatorTools) assert.ok(Object.hasOwn(capabilityRegistry, name));
  for (const name of ["travel.set_member", "health.ingest_batch", "library.complete_processing", "notifications.register_device", "money.void_entry"]) assert.equal(personalOperatorTools.has(name as CapabilityName), false);
});

test("stdio process emits only protocol output and stays usable after malformed input", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", new URL("../src/main.ts", import.meta.url).pathname], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH!, SHADOW_API_URL: "https://life.example.com", SHADOW_ACCESS_TOKEN: "test-token" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  child.stdin.end('{bad\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  assert.equal(await exited, 0, stderr);
  const lines = stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 2); assert.equal(lines[0].error.code, -32700); assert.deepEqual(lines[1].result, {});
});
