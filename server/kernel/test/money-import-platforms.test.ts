import assert from "node:assert/strict";
import test from "node:test";
import { applyMoneyImportRules, parseMoneyStatement } from "../src/money-import.js";

const timeZone = "Asia/Shanghai";
function table(headers: string[], rows: string[][]): string {
  return [headers, headers.map(() => "---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");
}

test("Taobao continuation lines retain item details but use the paid order total exactly once", () => {
  const content = table(["订单号", "订单提交时间", "订单状态", "店铺名称", "商品名称", "商品数量", "商品金额", "实付金额", "型号款式"], [
    ["order-001", "2026-10-01 10:00:00", "交易成功", "示例店铺", "商品甲", "1", "12.00", "20.00", "红色"],
    ["", "", "", "", "商品乙", "2", "15.00", "", ""],
    ["order-002", "2026-10-02 10:00:00", "交易关闭", "示例店铺", "未购买商品", "1", "9.00", "9.00", ""]
  ]);
  const candidates = parseMoneyStatement({ format: "markdown", content, timeZone });
  assert.equal(candidates.length, 2);
  const paid = candidates[0]!;
  assert.equal(paid.platform, "taobao");
  assert.equal(paid.externalId, "order-001");
  assert.equal(paid.identityKind, "expense");
  assert.equal(paid.proposed.amount, "20.00");
  assert.equal(paid.proposed.note, "商品甲；商品乙");
  assert.equal((paid.raw.rows as unknown[]).length, 2);
  assert.deepEqual(paid.raw.items, [{ name: "商品甲", quantity: "1", amount: "12.00", variant: "红色" }, { name: "商品乙", quantity: "2", amount: "15.00" }]);
  assert.deepEqual(paid.issues, []);
  assert.ok(candidates[1]!.issues.includes("non_completed_transaction"));
});

test("orphan Taobao item rows remain visible and cannot manufacture a settled order", () => {
  const [item] = parseMoneyStatement({ format: "json", platform: "taobao", timeZone, content: JSON.stringify([{ 商品名称: "孤立商品", 商品金额: "5.00", 商品数量: "1" }]) });
  assert.ok(item!.issues.includes("orphan_order_item"));
  assert.ok(item!.issues.includes("missing_amount"));
  assert.equal(item!.proposed.amount, undefined);
  assert.equal(item!.externalId, undefined);
});

test("Meituan payments and refunds keep their own event IDs without inventing a meal or original link", () => {
  const content = table(["交易创建时间", "交易成功时间", "交易类型", "订单标题", "收/支", "订单金额", "实付金额", "交易单号", "商家单号", "支付方式"], [
    ["2026-10-01 10:00:00", "2026-10-01 10:01:00", "支付", "午餐订单", "支出", "30.00", "28.00", "pay-001", "order-001", "微信支付"],
    ["2026-10-02 10:00:00", "2026-10-02 10:01:00", "退款", "部分退款", "收入", "5.00", "5.00", "refund-001", "order-001", ""],
    ["2026-10-03 10:00:00", "2026-10-03 10:01:00", "退款", "再次退款", "收入", "3.00", "3.00", "refund-002", "order-001", ""]
  ]);
  const [payment, refund, partial] = parseMoneyStatement({ format: "markdown", content, timeZone });
  assert.equal(payment!.platform, "meituan");
  assert.equal(payment!.proposed.amount, "28.00");
  assert.equal(payment!.proposed.payment_method, "wechat");
  assert.equal(payment!.proposed.entry_type, "expense");
  assert.equal(refund!.proposed.entry_type, "refund");
  assert.equal(refund!.identityKind, "refund");
  assert.equal(refund!.externalId, "refund-001");
  assert.equal(partial!.externalId, "refund-002");
  assert.ok(refund!.warnings.includes("refund_unlinked"));
  assert.equal("original_entry_id" in refund!.proposed, false);
  assert.equal("meal" in payment!.proposed, false);
  assert.deepEqual(payment!.issues, []);
});

test("Meituan unknown settlement and missing refund transaction IDs remain explicit", () => {
  const [refund, unsettled] = parseMoneyStatement({ format: "json", platform: "meituan", timeZone, content: JSON.stringify([
    { 交易创建时间: "2026-10-02 10:00:00", 交易成功时间: "2026-10-02 10:01:00", 交易类型: "退款", 订单标题: "退款", 实付金额: "5.00", 订单号: "order-001" },
    { 交易创建时间: "2026-10-02 10:00:00", 交易类型: "支付", 订单标题: "待支付", 实付金额: "5.00", 交易单号: "pay-001" }
  ]) });
  assert.equal(refund!.externalId, undefined);
  assert.ok(refund!.warnings.includes("missing_stable_external_id"));
  assert.ok(unsettled!.issues.includes("unsettled_transaction"));
});

test("JD amount annotations preserve original expense and separate explicit refund events", () => {
  const content = table(["交易时间", "商户名称", "交易说明", "金额", "交易状态", "收/支", "交易分类", "交易订单号", "商家订单号", "收/付款方式"], [
    ["2026-10-01 12:00:00", "示例商户", "商品", "88.00(已全额退款)", "交易成功", "不计收支", "食品酒饮", "pay-001", "order-001", "无法识别的银行尾号"],
    ["2026-10-02 12:00:00", "示例商户", "退款", "88.00", "退款成功", "不计收支", "食品酒饮", "refund-001", "order-001", ""],
    ["2026-10-03 12:00:00", "示例商户", "取消", "9.00", "交易失败", "支出", "食品酒饮", "pay-002", "order-002", ""]
  ]);
  const [payment, refund, failed] = parseMoneyStatement({ format: "markdown", content, timeZone });
  assert.equal(payment!.platform, "jd");
  assert.equal(payment!.proposed.amount, "88.00");
  assert.equal(payment!.proposed.entry_type, "expense");
  assert.equal(payment!.proposed.payment_method, undefined);
  assert.ok(payment!.warnings.includes("platform_excluded_from_balance"));
  assert.ok(payment!.warnings.includes("source_amount_annotation"));
  assert.equal(refund!.proposed.entry_type, "refund");
  assert.notEqual(payment!.externalId, refund!.externalId);
  assert.ok(failed!.issues.includes("non_completed_transaction"));
});

test("Alipay and WeChat tables are source-scoped while generic platform can be selected explicitly", () => {
  const alipay = { 交易时间: "2026-10-01 10:00:00", 交易对方: "示例商户", 商品说明: "纸巾", 金额: "12.30", "收/支": "支出", 交易状态: "交易成功", 交易订单号: "same-001" };
  const wechat = { 交易时间: "2026-10-01 10:00:00", 交易对方: "示例商户", 商品: "纸巾", "金额(元)": "12.30", "收/支": "支出", 当前状态: "支付成功", 交易单号: "same-001" };
  assert.equal(parseMoneyStatement({ format: "json", timeZone, content: JSON.stringify([alipay]) })[0]!.platform, "alipay");
  assert.equal(parseMoneyStatement({ format: "json", timeZone, content: JSON.stringify([wechat]) })[0]!.platform, "wechat");
  assert.equal(parseMoneyStatement({ format: "json", platform: "generic", timeZone, content: JSON.stringify([alipay]) })[0]!.platform, "generic");
});

test("merchant rules cannot turn refunds into spending or overwrite monetary source evidence", () => {
  const [original] = parseMoneyStatement({ format: "json", timeZone, content: '[{"date":"2026-10-01","type":"refund","amount":"5.00","merchant":"示例商户","id":"refund-1"}]' });
  const [mapped] = applyMoneyImportRules([original!], [{ id: "rule-001", matchValue: "示例商户", replacements: { entry_type: "expense", amount: "999.00", occurred_on: "2026-11-01", category: "日用" } }]);
  assert.equal(mapped!.proposed.entry_type, "refund");
  assert.equal(mapped!.proposed.amount, "5.00");
  assert.equal(mapped!.proposed.occurred_on, "2026-10-01");
  assert.equal(mapped!.identityKind, "refund");
  assert.equal(mapped!.externalId, "refund-1");
  assert.equal(mapped!.proposed.category, "日用");
});

test("JSON numeric tokens retain exact long transaction IDs and decimals before normalization", () => {
  const [candidate] = parseMoneyStatement({ format: "json", timeZone, content: '[{"date":"2026-10-01","type":"expense","amount":123456789012345678.91,"id":2026100100000000000123456789}]' });
  assert.equal(candidate!.externalId, "2026100100000000000123456789");
  assert.equal(candidate!.proposed.amount, "123456789012345678.91");
  assert.equal(candidate!.raw.amount, "123456789012345678.91");
  assert.deepEqual(candidate!.issues, []);
});

test("CSV accepts BOM, export preamble, quoted newlines, CRLF and known trailing summaries", () => {
  const [candidate] = parseMoneyStatement({ format: "csv", timeZone, content: '\uFEFF平台账单\r\n导出时间：2026-10-25\r\n\r\ndate,type,amount,merchant,note\r\n2026-10-01,expense,12.30,示例商户,"第一行\r\n第二行"\r\n共1笔记录\r\n支出：12.30元\r\n' });
  assert.equal(candidate!.proposed.amount, "12.30");
  assert.equal(candidate!.proposed.note, "第一行\r\n第二行");
});

test("malformed tables are rejected without silently truncating or shifting transaction fields", () => {
  for (const content of [
    'date,type,amount\n2026-10-01,expense,1,extra',
    'date,type,amount\n2026-10-01,expense',
    'date,type,amount\n2026-10-01,expense,"1"oops',
    'date,type,amount\n2026-10-01,expense,"1',
    'date,type,amount\n2026-10-01,expense,1\n合计：1元\n2026-10-02,expense,2'
  ]) assert.throws(() => parseMoneyStatement({ format: "csv", timeZone, content }), /cells|quote|footer/u);
  assert.throws(() => parseMoneyStatement({ format: "markdown", timeZone, content: '| date | type | amount |\n| --- | --- | --- |\n| 2026-10-01 | expense | 1 | extra |' }), /cells/u);
});

test("invalid calendar and clock values stay invalid while ISO timestamp dates are retained", () => {
  const candidates = parseMoneyStatement({ format: "json", timeZone, content: JSON.stringify(["2026-02-30", "2026-10-01 25:30:00", "2026-10-01123", "2026-10-01T12:30:00+08:00"].map(date => ({ date, type: "expense", amount: "1.00" }))) });
  assert.ok(candidates.slice(0, 3).every(row => row.issues.includes("invalid_date")));
  assert.equal(candidates[3]!.proposed.occurred_on, "2026-10-01");
});

test("payment refund-status updates do not become a second refund transaction", () => {
  for (const status of ["已退款", "已全额退款", "已退款(￥5.00)", "退款成功"]) {
    const [candidate] = parseMoneyStatement({ format: "json", platform: "wechat", timeZone, content: JSON.stringify([{ 交易时间: "2026-10-01 10:00:00", 交易类型: "商户消费", 交易对方: "示例商户", 商品: "商品", 金额: "5.00", "收/支": "支出", 当前状态: status, 交易单号: "payment-1" }]) });
    assert.equal(candidate!.proposed.entry_type, "expense");
    assert.equal(candidate!.identityKind, "expense");
    assert.ok(candidate!.warnings.includes("refund_status_is_not_refund_event"));
  }
});

test("malformed digit grouping never silently changes imported money", () => {
  const candidates = parseMoneyStatement({ format: "json", timeZone, content: JSON.stringify(["1,2", "1 2", "1,234.50", "￥ 1，234.50"].map(amount => ({ date: "2026-10-01", type: "expense", amount }))) });
  assert.ok(candidates.slice(0, 2).every(row => row.issues.includes("invalid_amount")));
  assert.equal(candidates[2]!.proposed.amount, "1234.50");
  assert.equal(candidates[3]!.proposed.amount, "1234.50");
});

test("numeric JSON identifiers cannot use exponent or fractional spellings that defeat identity matching", () => {
  for (const id of ["1e20", "1.2", "-123"]) assert.throws(() => parseMoneyStatement({ format: "json", timeZone, content: `[{"date":"2026-10-01","type":"expense","amount":"1.00","id":${id}}]` }), /identifiers/u);
});

test("export trailing delimiters are tolerated only when no data would be discarded", () => {
  const [candidate] = parseMoneyStatement({ format: "csv", timeZone, content: 'date,type,amount,\n2026-10-01,expense,1.00,\n' });
  assert.deepEqual(candidate!.issues, []);
  assert.equal(candidate!.proposed.amount, "1.00");
  assert.throws(() => parseMoneyStatement({ format: "csv", timeZone, content: 'date,type,amount,\n2026-10-01,expense,1.00,unlabelled-data' }), /cells/u);
});

test("offset timestamps use the requested timezone while date-only and local exports retain their day", () => {
  const values = ["2026-10-01T23:30:00Z", "2026-10-02T00:30:00+14:00", "2026-10-01", "2026-10-01 23:30:00", "2026-10-01T12:30:00+99:00"];
  const candidates = parseMoneyStatement({ format: "json", timeZone, content: JSON.stringify(values.map(date => ({ date, type: "expense", amount: "1.00" }))) });
  assert.equal(candidates[0]!.proposed.occurred_on, "2026-10-02");
  assert.equal(candidates[1]!.proposed.occurred_on, "2026-10-01");
  assert.equal(candidates[2]!.proposed.occurred_on, "2026-10-01");
  assert.equal(candidates[3]!.proposed.occurred_on, "2026-10-01");
  assert.ok(candidates[4]!.issues.includes("invalid_date"));
  assert.ok(candidates[0]!.warnings.includes("timestamp_date_in_requested_time_zone"));
  assert.equal(candidates[0]!.raw.date, values[0]);
});
