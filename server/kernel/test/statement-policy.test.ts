import assert from "node:assert/strict";
import test from "node:test";
import { decideStatementCandidate, statementChunks, type StatementCandidate, type StatementEntry } from "../src/statement-policy.js";
const candidate = (extra: Partial<StatementCandidate> = {}): StatementCandidate => ({ id: "candidate_a", batch_id: "batch", platform: "meituan", source_account: "default", external_id: "pay_001", identity_kind: "expense", raw: { rows: [{ 商家单号: "order_001", 交易成功时间: "2026-10-01 12:00:00" }] }, source_proposed: { entry_type: "expense", amount: "12.30", currency: "CNY", occurred_on: "2026-10-01" }, proposed: { entry_type: "expense", amount: "12.30", currency: "CNY", occurred_on: "2026-10-01", time_zone: "Asia/Shanghai", counterparty: "合成商家" }, issues: [], status: "pending", duplicate_of_record_id: null, duplicate_of_candidate_id: null, linked_record_id: null, revision: 1, ...extra });
const entry: StatementEntry = { id: "money", record_id: "record", amount: "12.300000", currency: "CNY", entry_type: "expense", occurred_on: "2026-10-01", occurred_at: "2026-10-01T04:00:00Z", counterparty: "支付宝-合成商家", refunded: "0" };

test("normal file transactions are processed directly; exact prior payments and uncertain overlaps differ", () => {
  const c = candidate();
  assert.equal(decideStatementCandidate(c, [], [c]).decision, "confirm");
  assert.equal(decideStatementCandidate(c, [entry], [c]).decision, "ignore");
  assert.equal(decideStatementCandidate(c, [{ ...entry, occurred_at: null }], [c]).decision, "pending");
});
test("source identity conflicts are found on both sides before automatic accounting", () => {
  const a = candidate(), b = candidate({ id: "candidate_b", source_proposed: { ...a.source_proposed, amount: "20.00" } });
  assert.equal(decideStatementCandidate(a, [], [a, b]).reason, "source_identity_conflict");
  assert.equal(decideStatementCandidate(b, [], [a, b]).decision, "pending");
});
test("refunds need a unique original expense and a sufficient remaining balance", () => {
  const original = candidate({ status: "confirmed", linked_record_id: "record" });
  const refund = candidate({ id: "refund", external_id: "refund_001", identity_kind: "refund", proposed: { ...original.proposed, entry_type: "refund", amount: "2.30" }, source_proposed: { ...original.source_proposed, entry_type: "refund", amount: "2.30" } });
  assert.equal(decideStatementCandidate(refund, [entry], [original, refund]).original_entry_id, "money");
  assert.equal(decideStatementCandidate(refund, [{ ...entry, refunded: "11.00" }], [original, refund]).decision, "pending");
  assert.equal(decideStatementCandidate(refund, [entry], [refund]).decision, "pending");
});
test("closed orders and non-cashflow rows do not become expenses", () => {
  const c = candidate({ raw: { rows: [{ 交易状态: "交易关闭" }] }, issues: ["non_completed_transaction"] });
  assert.equal(decideStatementCandidate(c, [], [c]).decision, "ignore");
  const uncertain = candidate({ issues: ["missing_date"] });
  assert.equal(decideStatementCandidate(uncertain, [], [uncertain]).decision, "pending");
});
test("complete Taobao orders remain in one bounded chunk and huge orders fail explicitly", () => {
  const rows = Array.from({ length: 99 }, (_, i) => ({ 订单号: String(i) }));
  const chunks = statementChunks([...rows, { 订单号: "last" }, { 订单号: "" }]);
  assert.deepEqual(chunks.map(c => c.length), [99, 2]);
  assert.throws(() => statementChunks([{ 订单号: "large" }, ...Array.from({ length: 500 }, () => ({ 订单号: "" }))]));
});
