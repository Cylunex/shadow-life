import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { AssetService } from "../src/index.js";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("file reconciliation preserves gross payments, finishes duplicate refunds across chunks and retains originals", pgOnly, async t => {
  const f = await reviewFixture(t);
  const payment = { 交易时间: "2026-10-01 12:31:06", 金额: "36.50元(已退款6.50)", "收/支": "支出", 交易类型: "支付", 交易状态: "交易成功", 交易订单号: "synthetic-pay", 商家订单号: "synthetic-order", 商户名称: "合成商家", 交易说明: "合成商品" };
  const refund = { ...payment, 交易时间: "2026-10-02 12:44:53", 金额: "6.50元", "收/支": "不计收支", 交易类型: "退款", 退款单号: "synthetic-refund" };
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
  for (const [kind, timestamp] of [["expense", "2026-10-01T04:31:06.000Z"], ["refund", "2026-10-02T04:44:53.000Z"]] as const) {
    const candidate = candidates.find(c => c.status === "confirmed" && c.identity_kind === kind)!;
    assert.equal(candidate.proposed.occurred_at, timestamp);
    const record = await f.queries.lifeRecord(f.context, candidate.linked_record_id!);
    assert.equal(record.kind, "record");
    assert.equal(record.occurred_at, timestamp);
    assert.equal(record.money_entry?.entry_type, kind);
    assert.equal(record.money_entry?.occurred_at, timestamp);
  }
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


test("confirming text candidates preserves exact seconds and leaves date-only payments and refunds timeless", pgOnly, async t => {
  const f = await reviewFixture(t);
  const stage = await f.run("money.stage_import", {
    format: "csv", time_zone: "Asia/Shanghai", source_name: "synthetic-clock.csv",
    content: [
      "occurred_at,type,amount,id",
      "2026-10-01 12:31:06,expense,36.50,timed-pay",
      "2026-10-02T00:06:09+08:00,refund,6.50,timed-refund",
      "2026-10-03,expense,10.00,day-pay",
      "2026-10-04,refund,3.00,day-refund",
      "2026-10-10 12:05:08,income,50.00,correct-day"
    ].join("\n")
  });
  const batch = await f.queries.moneyImportReview(f.context, String(stage.actual_values.batch_id));
  assert.equal(batch.candidates[0]?.proposed.occurred_at, "2026-10-01T04:31:06.000Z");
  // Simulate a pending candidate created by the old parser, with the intact source row.
  await f.pool.query(`update money_import_candidates set proposed=proposed-'occurred_at', source_proposed=source_proposed-'occurred_at' where id=$1`, [batch.candidates[0]!.id]);
  let originalEntryId: string | undefined;
  for (const [index, day, timestamp] of [
    [0,"2026-10-01","2026-10-01T04:31:06.000Z"],
    [1,"2026-10-02","2026-10-01T16:06:09.000Z"],
    [2,"2026-10-03",null],
    [3,"2026-10-04",null],
    [4,"2026-10-11","2026-10-11T04:05:08.000Z"],
  ] as const) {
    const candidate = batch.candidates[index]!;
    const kind = candidate.proposed.entry_type;
    const receipt = await f.run("money.resolve_import_candidate", {
      candidate_id: candidate.id, expected_revision: candidate.revision, decision: "confirm", reason: "合成账单验收",
      ...(kind === "refund" ? { original_entry_id: originalEntryId } : {}),
      ...(index === 4 ? { corrections: { occurred_on: day } } : {})
    });
    if (kind === "expense") originalEntryId = String(receipt.actual_values.money_entry_id);
    const record = await f.queries.lifeRecord(f.context, String(receipt.actual_values.money_entry_id));
    assert.equal(record.kind, "record");
    assert.equal(record.state, "confirmed");
    assert.equal(record.occurred_on, day);
    assert.equal(record.occurred_at, timestamp);
    assert.equal(record.money_entry?.entry_type, kind);
    assert.equal(record.money_entry?.occurred_on, day);
    assert.equal(record.money_entry?.occurred_at, timestamp);
  }
  const confirmed = await f.queries.moneyImportReview(f.context, batch.batch.id);
  assert.equal(confirmed.candidates[0]!.proposed.occurred_at, "2026-10-01T04:31:06.000Z");
  assert.equal(confirmed.candidates[2]!.proposed.occurred_at, undefined);
  const links = await f.pool.query("select count(*)::int count from refunds where link_state='linked'");
  assert.equal(links.rows[0].count, 2);
});

test("XLSX date serials reach confirmed entries with their original clock precision", pgOnly, async t => {
  const f = await reviewFixture(t);
  const workbook = execFileSync("python3", ["-c", `
import io, sys, zipfile
from datetime import date
from decimal import Decimal
ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
day = Decimal((date(2026, 10, 1) - date(1904, 1, 1)).days)
serial = day + Decimal(12 * 3600 + 31 * 60 + 6) / 86400
out = io.BytesIO()
with zipfile.ZipFile(out, "w") as z:
    z.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}"><workbookPr date1904="1"/></workbook>')
    z.writestr("xl/styles.xml", f'<styleSheet xmlns="{ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>')
    z.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{ns}"><sheetData>'
        '<row><c r="A1" t="inlineStr"><is><t>date</t></is></c><c r="B1" t="inlineStr"><is><t>type</t></is></c><c r="C1" t="inlineStr"><is><t>amount</t></is></c></row>'
        f'<row><c r="A2" s="1"><v>{serial}</v></c><c r="B2" t="inlineStr"><is><t>expense</t></is></c><c r="C2"><v>3.20</v></c></row>'
        f'<row><c r="A3" s="2"><v>{day+1}</v></c><c r="B3" t="inlineStr"><is><t>expense</t></is></c><c r="C3"><v>7.10</v></c></row>'
        '</sheetData></worksheet>')
sys.stdout.buffer.write(out.getvalue())
`]);
  const asset = await new AssetService(f.pool).store(f.context.subjectId, "application/octet-stream", workbook);
  const receipt = await f.run("money.import_file", { asset_version_id: asset.asset_version_id, source_name: "synthetic.xlsx", time_zone: "Asia/Shanghai" });
  assert.equal(receipt.actual_values.confirmed, 2);
  const file = await f.queries.moneyImportFile(f.context, String(receipt.actual_values.file_id));
  const batch = await f.queries.moneyImportReview(f.context, file.batches[0]!.batch_id);
  for (const [index, day, timestamp] of [[0,"2026-10-01","2026-10-01T04:31:06.000Z"],[1,"2026-10-02",null]] as const) {
    const record = await f.queries.lifeRecord(f.context, batch.candidates[index]!.linked_record_id!);
    assert.equal(record.kind, "record");
    assert.equal(record.money_entry?.occurred_on, day);
    assert.equal(record.money_entry?.occurred_at, timestamp);
  }
});
