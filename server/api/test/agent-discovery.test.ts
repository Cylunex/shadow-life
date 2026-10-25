import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry } from "@shadow/contracts";
import { createApp } from "../src/app.js";

const headers = { authorization: "Bearer dev:subject_test" };
function dependencies() { return { unitOfWork: { ensurePrincipal: async () => undefined, pool: { query: async () => ({ rows: [] }) } }, executor: {}, queries: {}, developmentAuth: true } as unknown as Parameters<typeof createApp>[0]; }

test("catalog embeds optional schemas in one authorized request and retains compact discovery", async () => {
  const app = createApp(dependencies());
  assert.equal((await app.request("/api/capabilities?include_schemas=true")).status, 401);
  const compact = await (await app.request("/api/capabilities", { headers })).json() as any;
  assert.equal(compact.capabilities[0].input_schema, undefined);
  const complete = await (await app.request("/api/capabilities?include_schemas=true", { headers })).json() as any;
  assert.equal(complete.capabilities.length, Object.keys(capabilityRegistry).length);
  assert.ok(complete.capabilities.every((item: any) => item.input_schema?.type === "object"));
  assert.ok(complete.capabilities.some((item: any) => item.name === "operations.find"));
});

test("receipt lookup validates command key before invoking the existing subject-bound executor", async () => {
  const deps = dependencies(); let found: unknown;
  deps.executor = { findOperationByCommand: async (context: unknown, key: string) => { found = { context, key }; return { ok: true }; } } as any;
  const app = createApp(deps);
  assert.equal((await app.request("/api/operations/by-command/bad-key", { headers })).status, 422); assert.equal(found, undefined);
  assert.equal((await app.request("/api/operations/by-command/cmd_lookup_0001", { headers })).status, 200);
  assert.equal((found as any).context.subjectId, "subject_test"); assert.equal((found as any).key, "cmd_lookup_0001");
});
