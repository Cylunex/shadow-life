import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryService, type UnitOfWork } from "../../../server/kernel/src/index.js";
import { createApp } from "../../../server/api/src/app.js";
import { runAgentTool, validateToolInput } from "../src/agent-tools.js";
import { AgentToolsPanel } from "../src/AgentToolsPanel.js";

const headers = { authorization: "Bearer dev:subject_catalog" };
function fixture() {
  const queries = new QueryService({ read: () => { throw new Error("validation accessed storage"); } } as unknown as UnitOfWork);
  const deps = { unitOfWork: {}, executor: {}, queries, developmentAuth: true } as unknown as Parameters<typeof createApp>[0];
  const app = createApp(deps);
  return { queries, request: ((url: string, init: RequestInit) => app.request(url, init)) as typeof fetch };
}

test("validation and malformed input never submit a command", async () => {
  const { request } = fixture(); let commands = 0;
  const value = await validateToolInput(request, headers, "money.record_entry", {});
  assert.equal(value.valid, false); assert.equal(value.executed, false);
  await assert.rejects(() => runAgentTool(request, headers, async () => { commands++; throw new Error("unexpected"); }, "money.record_entry", {}));
  assert.equal(commands, 0);
});
test("read execution uses its real typed transport and cannot claim a save", async () => {
  const { request } = fixture();
  const result = await runAgentTool(request, headers, async () => { throw new Error("read reached write path"); }, "agent.glossary", { query: "次卡" });
  assert.equal(result.mode, "read"); assert.ok((result.value as any).terms.some((term: any) => term.id === "card"));
  assert.equal((result.value as any).status, undefined);
});
test("ordinary write goes through the existing retry-aware command controller contract", async () => {
  const { request } = fixture(); const seen: unknown[] = [];
  const input = { entry_type: "expense", amount: "12.30", currency: "CNY", occurred_on: "2026-10-12", time_zone: "Asia/Shanghai" };
  const result = await runAgentTool(request, headers, async (name, value, scope) => {
    seen.push({ name, value, scope });
    return { protocol: "shadow.execution-result", status: "committed", command_id: "cmd_catalog_12345678", capability: name } as any;
  }, "money.record_entry", input);
  assert.equal(result.mode, "write"); assert.equal(seen.length, 1);
  assert.equal((seen[0] as any).scope, "agent-tools:money.record_entry");
  assert.equal((seen[0] as any).name, "money.record_entry"); assert.equal((seen[0] as any).value.amount, "12.30");
});
test("administration and destructive tools require their dedicated execution entry", async () => {
  const { request } = fixture(); let commands = 0;
  await assert.rejects(() => runAgentTool(request, headers, async () => { commands++; throw new Error("unexpected"); }, "life.void_purchase", {}), /专用操作入口/);
  assert.equal(commands, 0);
});
test("debug panel exposes a labeled parameter editor and distinguishes snapshots from deployment", () => {
  const html = renderToStaticMarkup(React.createElement(AgentToolsPanel, { headers, execute: async () => { throw new Error("unused"); }, onClose: () => {}, onChanged: async () => {} }));
  assert.match(html, /能力目录与调试/); assert.match(html, /只看查询工具/);
  assert.match(html, /导出当前目录/); assert.match(html, /比较不会发布或恢复配置/);
  assert.match(html, /aria-labelledby="agent-tools-title"/);
});
