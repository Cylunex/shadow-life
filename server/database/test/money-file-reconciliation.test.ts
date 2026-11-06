import assert from "node:assert/strict";
import test from "node:test";
import { AssetService } from "../src/index.js";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("file reconciliation preserves gross payments, finishes duplicate refunds across chunks and retains originals", pgOnly, async t => {
  const f = await reviewFixture(t);
  const payment = { 交易时间: "2026-10-01 12:00:00", 金额: "36.50元(已退款6.50)", "收/支": "支出", 交易类型: "支付", 交易状态: "交易成功", 交易订单号: "synthetic-pay", 商家订单号: "synthetic-order", 商户名称: "合成商家", 交易说明: "合成商品" };
  const refund = { ...payment, 交易时间: "2026-10-02 12:00:00", 金额: "6.50元", "收/支": "不计收支", 交易类型: "退款", 退款单号: "synthetic-refund" };
  const rows = [payment, refund, ...Array.from({ length: 98 }, (_, i) => ({ ...payment, 交易订单号: `synthetic-zero-${i}`, 金额: "0.00元" })), payment, refund,
    { ...payment, 交易订单号: "synthetic-reward", 金额: "7.00元", "收/支": "不计收支", 交易说明: "非现金奖励" },
    { ...payment, 交易订单号: "synthetic-closed", 金额: "9.00元", 交易状态: "交易关闭" }];
  const upload = async (body: unknown[]) => {
    return (await new AssetService(f.pool).store(f.context.subjectId, "application/octet-stream", Buffer.from(JSON.stringify(body)))).asset_version_id;
  };
  const asset = await upload(rows);
  const input = { asset_version_id: asset, source_name: "synthetic.json", platform: "jd", time_zone: "Asia/Shanghai" };
  const command = f.command("money.import_file", input);
  const receipt = await f.executor.execute(f.context, command);
  assert.ok(receipt.execution_id);
  assert.equal(receipt.actual_values.confirmed, 2);
  assert.equal(receipt.actual_values.ignored, 102);
  assert.equal(receipt.actual_values.pending, 0);
  const status = await f.queries.moneyImportFile(f.context, String(receipt.actual_values.file_id));
  assert.equal(status.status, "completed");
  assert.equal(status.batches.length, 2);
  const candidates = (await Promise.all(status.batches.map(b => f.queries.moneyImportReview(f.context, b.batch_id)))).flatMap(b => b.candidates);
  assert.equal(candidates.filter(c => c.status === "invalid" || c.status === "pending").length, 0);
  assert.deepEqual(candidates.find(c => c.status === "confirmed" && c.identity_kind === "expense")!.raw.rows, [payment]);
  assert.equal((await f.executor.execute(f.context, command)).replayed, true);
  assert.equal((await f.run("money.import_file", { ...input, source_name: "renamed.json" })).actual_values.file_id, status.file_id);
  const totals = (await f.pool.query("select entry_type,sum(amount)::text total from money_entries group by entry_type order by entry_type")).rows;
  assert.deepEqual(totals, [{ entry_type: "expense", total: "36.500000" }, { entry_type: "refund", total: "6.500000" }]);
  const links = (await f.pool.query("select original.amount::text original_amount,back.amount::text refund_amount from refunds r join money_entries original on original.id=r.original_entry_id join money_entries back on back.id=r.refund_entry_id")).rows;
  assert.deepEqual(links, [{ original_amount: "36.500000", refund_amount: "6.500000" }]);
  assert.equal((await f.pool.query("select count(*)::int n from sources where asset_version_id=$1", [asset])).rows[0].n, 2);

  // A second source ID with the same refund facts is uncertain, not proof of another refund.
  const overlap = await upload([{ ...refund, 退款单号: "synthetic-other-channel-refund" }]);
  const pending = await f.run("money.import_file", { ...input, asset_version_id: overlap });
  const readback = await f.queries.moneyImportFile(f.context, String(pending.actual_values.file_id));
  assert.equal(readback.pending, 1);
  assert.deepEqual(readback.pending_reasons, [{ code: "possible_existing_refund", count: 1 }]);
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n, 2);
});
