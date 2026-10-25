import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "../../database/test/review-fixture.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { createApp } from "../../api/src/app.js";

test("personal MCP imports statements through HTTP, recovers lost receipts and retains refund and duplicate boundaries", pgOnly, async t => {
  const fixture = await reviewFixture(t), app = createApp({ ...fixture, developmentAuth: true });
  let drop = true;
  const client = new LifeClient({ api: "http://life.example.com", token: `dev:${fixture.context.subjectId}`, profile: "personal", fetch: async (url, init) => {
    const response = await app.request(String(url), init);
    if (String(url).includes("/commands/money.stage_import") && drop) {
      assert.equal(response.status, 201, await response.clone().text());
      drop = false;
      throw new TypeError("response lost after commit");
    }
    return response;
  } });
  const handler = createMcpServer(client, []);
  const request = async (method: string, params: unknown): Promise<any> => handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  const call = async (name: string, args: unknown) => (await request("tools/call", { name, arguments: args })).result;
  const catalog = (await request("tools/list", {})).result.tools;
  for (const name of ["money.stage_import", "money.resolve_import_candidate", "money.import_review", "money.import_history", "money.import_month"]) assert.ok(catalog.some((tool: { name: string }) => tool.name === name));
  assert.ok(!catalog.some((tool: { name: string }) => tool.name === "money.set_import_rule"));
  const payment = { 交易创建时间: "2026-10-01 10:00:00", 交易成功时间: "2026-10-01 10:01:00", 交易类型: "支付", 订单标题: "合成订单", "收/支": "支出", 实付金额: "12.30", 交易单号: "synthetic-pay-001", 商家单号: "synthetic-order-001" };
  const refund = { ...payment, 交易类型: "退款", "收/支": "收入", 实付金额: "2.30", 交易单号: "synthetic-refund-001" };
  const args = { command_id: "cmd_mcp_statement_001", input: { format: "json", platform: "meituan", source_name: "example.json", time_zone: "Asia/Shanghai", content: JSON.stringify([payment, refund]) } };
  const lost = await call("money.stage_import", args);
  assert.equal(lost.structuredContent.code, "outcome_unknown");
  const receipt = (await call("operations.find", { command_id: args.command_id })).structuredContent;
  assert.equal(receipt.status, "committed");
  assert.equal((await call("money.stage_import", args)).structuredContent.replayed, true);
  const batchId = receipt.actual_values.batch_id;
  const review = (await call("money.import_review", { batch_id: batchId })).structuredContent;
  assert.equal(review.batch.total, 2);
  assert.equal((await fixture.pool.query("select count(*)::int count from money_entries")).rows[0].count, 0);
  const paid = (await call("money.resolve_import_candidate", { command_id: "cmd_mcp_statement_pay_001", input: { candidate_id: review.candidates[0].id, expected_revision: 1, decision: "confirm", reason: "核对合成明细" } })).structuredContent;
  assert.equal(paid.status, "committed");
  const detail = (await call("life.get_record", { id: paid.actual_values.record_id })).structuredContent;
  assert.equal(detail.money_entry.amount, "12.300000");
  assert.equal(detail.money_entry.entry_type, "expense");
  const missing = await call("money.resolve_import_candidate", { command_id: "cmd_mcp_statement_refund_missing", input: { candidate_id: review.candidates[1].id, expected_revision: 1, decision: "confirm", reason: "尚无明确原交易" } });
  assert.equal(missing.isError, true);
  const refunded = await call("money.resolve_import_candidate", { command_id: "cmd_mcp_statement_refund_001", input: { candidate_id: review.candidates[1].id, expected_revision: 1, decision: "confirm", original_entry_id: paid.actual_values.money_entry_id, reason: "明确关联合成原交易" } });
  assert.equal(refunded.structuredContent.status, "committed");
  const overlap = (await call("money.stage_import", { command_id: "cmd_mcp_statement_overlap_001", input: { ...args.input, source_name: "example-overlap.json", content: JSON.stringify([payment]) } })).structuredContent;
  const duplicate = (await call("money.import_review", { batch_id: overlap.actual_values.batch_id })).structuredContent.candidates[0];
  assert.equal(duplicate.duplicate_of_record_id, paid.actual_values.record_id);
  const denied = await call("money.resolve_import_candidate", { command_id: "cmd_mcp_statement_duplicate_001", input: { candidate_id: duplicate.id, expected_revision: 1, decision: "confirm", reason: "重复导入应拒绝" } });
  assert.equal(denied.isError, true);
  assert.equal((await fixture.pool.query("select count(*)::int count from money_entries")).rows[0].count, 2);
});
